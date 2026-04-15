import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  PlusIcon,
  FolderPlusIcon,
  QuestionMarkCircleIcon,
  PencilIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { buildAdminCategoryBreadcrumbs } from './help-center-utils-admin'
import { HelpCenterListItem } from './help-center-list-item'
import { HelpCenterCategoryGroup } from './help-center-category-group'
import { CreateArticleDialog } from './create-article-dialog'
import { CategoryFormDialog } from './category-form-dialog'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import {
  useDeleteCategory,
  useRestoreCategory,
  useRestoreArticle,
} from '@/lib/client/mutations/help-center'
import { collectDescendantIds } from '@/lib/server/domains/help-center/category-tree'
import { useHelpCenterFilters } from './use-help-center-filters'
import { HelpCenterActiveFiltersBar } from './help-center-active-filters-bar'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { TimeAgo } from '@/components/ui/time-ago'
import type { HelpCenterArticleId, HelpCenterCategoryId } from '@quackback/ids'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

function HelpCenterListSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="p-4">
          <Skeleton className="h-5 w-16 rounded-full mb-1" />
          <Skeleton className="h-5 w-3/4 mb-1" />
          <Skeleton className="h-3 w-full mb-2.5" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface HelpCenterFinderProps {
  onEditArticle: (id: HelpCenterArticleId) => void
  onDeleteArticle: (id: HelpCenterArticleId) => void
}

export function HelpCenterFinder({ onEditArticle, onDeleteArticle }: HelpCenterFinderProps) {
  const { filters } = useHelpCenterFilters()

  // When showDeleted is active, render the flat deleted-items view instead
  if (filters.showDeleted) {
    return <DeletedItemsView />
  }

  return <LiveHelpCenterFinder onEditArticle={onEditArticle} onDeleteArticle={onDeleteArticle} />
}

function LiveHelpCenterFinder({ onEditArticle, onDeleteArticle }: HelpCenterFinderProps) {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useHelpCenterFilters()

  const [createArticleOpen, setCreateArticleOpen] = useState(false)

  // Category dialog state — shared for both "new" and "edit" flows
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [categoryDialogParent, setCategoryDialogParent] = useState<HelpCenterCategoryId | null>(
    null
  )
  const [categoryDialogInitialValues, setCategoryDialogInitialValues] = useState<
    | {
        id: HelpCenterCategoryId
        name: string
        description: string | null
        icon: string | null
        isPublic: boolean
        parentId: HelpCenterCategoryId | null
      }
    | undefined
  >(undefined)

  // Delete category state
  const deleteCategoryMutation = useDeleteCategory()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const { data: allCategories = [] } = useQuery(helpCenterQueries.categories())

  const currentCategory = useMemo(
    () => allCategories.find((c) => c.id === filters.category),
    [allCategories, filters.category]
  )

  const children = useMemo(() => {
    if (!filters.category) {
      return allCategories.filter((c) => c.parentId === null)
    }
    return allCategories.filter((c) => c.parentId === filters.category)
  }, [allCategories, filters.category])

  const breadcrumbs = useMemo(
    () =>
      filters.category
        ? buildAdminCategoryBreadcrumbs({
            allCategories,
            categoryId: filters.category,
          })
        : [],
    [allCategories, filters.category]
  )

  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: filters.search,
    onChange: (search) => setFilters({ search }),
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    ...helpCenterQueries.articleList({
      categoryId: filters.category,
      status: filters.status === 'all' ? undefined : filters.status,
      search: filters.search,
      sort: filters.sort,
    }),
    // Only fetch when inside a category — the top-level view renders collapsible
    // groups that fetch their own article lists on demand.
    enabled: !!filters.category,
  })

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const articles = data?.pages.flatMap((page) => page.items) ?? []

  const titleIcon = currentCategory?.icon ?? null

  // ---------------------------------------------------------------------------
  // Dialog helpers
  // ---------------------------------------------------------------------------

  function openNewCategoryDialog(parentId: HelpCenterCategoryId | null) {
    setCategoryDialogInitialValues(undefined)
    setCategoryDialogParent(parentId)
    setCategoryDialogOpen(true)
  }

  function openEditCategoryDialog() {
    if (!currentCategory) return
    setCategoryDialogInitialValues({
      id: currentCategory.id,
      name: currentCategory.name,
      description: currentCategory.description,
      icon: currentCategory.icon,
      isPublic: currentCategory.isPublic,
      parentId: currentCategory.parentId,
    })
    setCategoryDialogParent(null)
    setCategoryDialogOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Cascade delete impact
  // ---------------------------------------------------------------------------

  const cascadeImpact = useMemo(() => {
    if (!currentCategory) return { descendantCount: 0, articleCount: 0 }
    const flat = allCategories as Array<{
      id: string
      parentId: string | null
      articleCount: number
    }>
    const descendantIds = collectDescendantIds(flat, currentCategory.id)
    const subtreeIds = new Set<string>([currentCategory.id, ...descendantIds])
    let totalArticles = 0
    for (const cat of flat) {
      if (subtreeIds.has(cat.id)) totalArticles += cat.articleCount
    }
    return { descendantCount: descendantIds.size, articleCount: totalArticles }
  }, [currentCategory, allCategories])

  const deleteDescription = useMemo(() => {
    if (!currentCategory) return ''
    const parts: string[] = []
    if (cascadeImpact.descendantCount > 0) {
      parts.push(
        `${cascadeImpact.descendantCount} sub-categor${cascadeImpact.descendantCount === 1 ? 'y' : 'ies'}`
      )
    }
    if (cascadeImpact.articleCount > 0) {
      parts.push(
        `${cascadeImpact.articleCount} article${cascadeImpact.articleCount === 1 ? '' : 's'}`
      )
    }
    if (parts.length === 0) {
      return `This will permanently delete "${currentCategory.name}". This cannot be undone from the UI.`
    }
    return `This will delete "${currentCategory.name}" along with ${parts.join(' and ')}. Everything can be restored from the database, but the UI provides no restore flow.`
  }, [currentCategory, cascadeImpact])

  async function handleDeleteCategory() {
    if (!currentCategory) return
    const parentId = currentCategory.parentId ?? null
    await deleteCategoryMutation.mutateAsync(currentCategory.id)
    setConfirmDeleteOpen(false)
    setFilters({ category: parentId ?? undefined })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const headerActions = currentCategory ? (
    <div className="flex items-center gap-1">
      <CategoryActionsDropdown
        onEdit={openEditCategoryDialog}
        onDelete={() => setConfirmDeleteOpen(true)}
      />
      <NewInsideDropdown
        onNewArticle={() => setCreateArticleOpen(true)}
        onNewSubcategory={() => openNewCategoryDialog(currentCategory.id)}
      />
    </div>
  ) : (
    <NewAtRootDropdown
      onNewArticle={() => setCreateArticleOpen(true)}
      onNewCategory={() => openNewCategoryDialog(null)}
    />
  )

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Breadcrumbs + search header */}
      <AdminListHeader
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder={
          currentCategory ? `Search in ${currentCategory.name}...` : 'Search all articles...'
        }
        sortOptions={SORT_OPTIONS}
        activeSort={filters.sort}
        onSortChange={(sort) => setFilters({ sort: sort as 'newest' | 'oldest' })}
        action={headerActions}
      >
        <div className="mt-1">
          <HelpCenterBreadcrumbs items={breadcrumbs} />
        </div>
        <HelpCenterActiveFiltersBar
          status={filters.status}
          search={filters.search}
          category={filters.category}
          showDeleted={filters.showDeleted}
          onClearStatus={() => setFilters({ status: 'all' })}
          onClearSearch={() => setFilters({ search: undefined })}
          onClearCategory={() => setFilters({ category: undefined })}
          onClearShowDeleted={() => setFilters({ showDeleted: undefined })}
          onClearAll={clearFilters}
        />
      </AdminListHeader>

      {/* When viewing a specific category: current category renders as a card
          (matching the root card style), followed by sub-category cards. */}
      {currentCategory ? (
        <section className="px-3 pb-4 space-y-2">
          {/* Current category as a card — always expanded since the user
              navigated into it. No chevron, just header + articles. */}
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-xl shrink-0">{titleIcon || '📁'}</span>
              <span className="font-medium text-sm text-foreground truncate">
                {currentCategory.name}
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {articles.length}
                {hasNextPage ? '+' : ''} article{articles.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="border-t border-border/50">
              {isLoading ? (
                <div className="p-3">
                  <HelpCenterListSkeleton />
                </div>
              ) : articles.length === 0 ? (
                <div className="px-4 py-6">
                  <EmptyState
                    icon={QuestionMarkCircleIcon}
                    title={
                      filters.search
                        ? 'No articles match your search'
                        : hasActiveFilters
                          ? 'No articles match your filters'
                          : 'No articles in this category yet'
                    }
                    action={
                      hasActiveFilters ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Clear all filters
                        </Button>
                      ) : undefined
                    }
                    className="h-32"
                  />
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {articles.map((article, index) => (
                    <div
                      key={article.id}
                      className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                      style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                    >
                      <HelpCenterListItem
                        id={article.id as HelpCenterArticleId}
                        title={article.title}
                        content={article.content}
                        publishedAt={article.publishedAt}
                        createdAt={article.createdAt}
                        category={article.category}
                        author={article.author}
                        viewCount={article.viewCount}
                        helpfulCount={article.helpfulCount}
                        onEdit={onEditArticle}
                        onDelete={onDeleteArticle}
                      />
                    </div>
                  ))}
                </div>
              )}
              {hasNextPage && (
                <div ref={loadMoreRef} className="border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Load more articles'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sub-categories as collapsible cards */}
          {children.map((sub) => (
            <HelpCenterCategoryGroup
              key={sub.id}
              category={sub}
              onNavigate={() => setFilters({ category: sub.id })}
              onEditArticle={onEditArticle}
              onDeleteArticle={onDeleteArticle}
            />
          ))}
        </section>
      ) : (
        /* Top-level view: show categories as collapsible groups */
        <>
          {children.length > 0 ? (
            <section className="px-3 pb-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Categories
              </h2>
              <div className="space-y-2">
                {children.map((cat) => (
                  <HelpCenterCategoryGroup
                    key={cat.id}
                    category={cat}
                    onNavigate={() => setFilters({ category: cat.id })}
                    onEditArticle={onEditArticle}
                    onDeleteArticle={onDeleteArticle}
                  />
                ))}
              </div>
            </section>
          ) : (
            <section className="px-3 pb-4">
              <EmptyState
                icon={QuestionMarkCircleIcon}
                title="No help categories yet"
                className="h-48"
              />
            </section>
          )}
        </>
      )}

      {/* Dialogs */}
      <CreateArticleDialog open={createArticleOpen} onOpenChange={setCreateArticleOpen} />
      <CategoryFormDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        initialValues={categoryDialogInitialValues}
        defaultParentId={categoryDialogInitialValues ? undefined : categoryDialogParent}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete "${currentCategory?.name ?? ''}"?`}
        description={deleteDescription}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteCategoryMutation.isPending}
        onConfirm={handleDeleteCategory}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deleted Items View
// ---------------------------------------------------------------------------

function DeletedItemsView() {
  const { data: deletedCategories = [], isLoading: categoriesLoading } = useQuery(
    helpCenterQueries.categories({ showDeleted: true })
  )

  const { data: deletedArticlesData, isLoading: articlesLoading } = useInfiniteQuery({
    ...helpCenterQueries.articleList({ showDeleted: true }),
  })

  const deletedArticles = deletedArticlesData?.pages.flatMap((p) => p.items) ?? []

  const restoreCategoryMutation = useRestoreCategory()
  const restoreArticleMutation = useRestoreArticle()

  const breadcrumbs = [{ label: 'Deleted' }]

  return (
    <div className="max-w-5xl mx-auto w-full">
      <AdminListHeader searchValue="" onSearchChange={() => {}} searchPlaceholder="Deleted items">
        <div className="mt-1">
          <HelpCenterBreadcrumbs items={breadcrumbs} />
        </div>
      </AdminListHeader>

      <div className="px-3 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Deleted items</h1>
      </div>

      {/* Deleted categories */}
      <section className="px-3 pb-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Deleted categories
        </h2>
        {categoriesLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : deletedCategories.length === 0 ? (
          <EmptyState
            icon={QuestionMarkCircleIcon}
            title="No deleted categories"
            className="h-32"
          />
        ) : (
          <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
            {deletedCategories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base">{cat.icon || '📁'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{cat.name}</p>
                  {cat.deletedAt && (
                    <p className="text-xs text-muted-foreground">
                      Deleted <TimeAgo date={cat.deletedAt as string} />
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restoreCategoryMutation.mutate(cat.id)}
                  disabled={restoreCategoryMutation.isPending}
                >
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5 mr-1" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Deleted articles */}
      <section className="px-3 pb-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Deleted articles
        </h2>
        {articlesLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : deletedArticles.length === 0 ? (
          <EmptyState icon={QuestionMarkCircleIcon} title="No deleted articles" className="h-32" />
        ) : (
          <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
            {deletedArticles.map((article) => (
              <div key={article.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{article.title}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="mr-2">{article.category.name}</span>
                    {article.deletedAt && (
                      <>
                        &middot; Deleted <TimeAgo date={article.deletedAt} />
                      </>
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restoreArticleMutation.mutate(article.id as HelpCenterArticleId)}
                  disabled={restoreArticleMutation.isPending}
                >
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5 mr-1" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CategoryActionsDropdownProps {
  onEdit: () => void
  onDelete: () => void
}

function CategoryActionsDropdown({ onEdit, onDelete }: CategoryActionsDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <EllipsisHorizontalIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <PencilIcon className="h-4 w-4 mr-2" />
          Edit category
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <TrashIcon className="h-4 w-4 mr-2" />
          Delete category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface NewInsideDropdownProps {
  onNewArticle: () => void
  onNewSubcategory: () => void
}

function NewInsideDropdown({ onNewArticle, onNewSubcategory }: NewInsideDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewArticle}>
          <PlusIcon className="h-4 w-4 mr-2" />
          New article
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewSubcategory}>
          <FolderPlusIcon className="h-4 w-4 mr-2" />
          New sub-category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface NewAtRootDropdownProps {
  onNewArticle: () => void
  onNewCategory: () => void
}

function NewAtRootDropdown({ onNewArticle, onNewCategory }: NewAtRootDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewArticle}>
          <PlusIcon className="h-4 w-4 mr-2" />
          New article
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewCategory}>
          <FolderPlusIcon className="h-4 w-4 mr-2" />
          New category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
