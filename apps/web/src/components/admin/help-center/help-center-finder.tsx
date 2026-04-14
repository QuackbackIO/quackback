import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  PlusIcon,
  FolderPlusIcon,
  QuestionMarkCircleIcon,
  PencilIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
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
import { HelpCenterSubcategoryCard } from './help-center-subcategory-card'
import { CreateArticleDialog } from './create-article-dialog'
import { CategoryFormDialog } from './category-form-dialog'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { useDeleteCategory } from '@/lib/client/mutations/help-center'
import { collectDescendantIds } from '@/lib/server/domains/help-center/category-tree'
import { useHelpCenterFilters } from './use-help-center-filters'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import type { HelpCenterArticleId, HelpCenterCategoryId } from '@quackback/ids'

interface HelpCenterFinderProps {
  onEditArticle: (id: HelpCenterArticleId) => void
  onDeleteArticle: (id: HelpCenterArticleId) => void
}

export function HelpCenterFinder({ onEditArticle, onDeleteArticle }: HelpCenterFinderProps) {
  const { filters, setFilters } = useHelpCenterFilters()

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
        : [{ label: 'Help Center', href: '/admin/help-center' }],
    [allCategories, filters.category]
  )

  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: filters.search,
    onChange: (search) => setFilters({ search }),
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    helpCenterQueries.articleList({
      categoryId: filters.category,
      status: filters.status === 'all' ? undefined : filters.status,
      search: filters.search,
    })
  )

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const articles = data?.pages.flatMap((page) => page.items) ?? []

  const title = currentCategory?.name ?? 'Help Center'
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

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Breadcrumbs + search header */}
      <AdminListHeader
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder={
          currentCategory ? `Search in ${currentCategory.name}...` : 'Search all articles...'
        }
      >
        <div className="mt-1">
          <HelpCenterBreadcrumbs items={breadcrumbs} />
        </div>
      </AdminListHeader>

      {/* Category/page title + action buttons */}
      <div className="px-3 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          {titleIcon && <span>{titleIcon}</span>}
          {title}
        </h1>
        <div className="flex items-center gap-2">
          {currentCategory ? (
            <>
              <CategoryActionsDropdown
                onEdit={openEditCategoryDialog}
                onDelete={() => setConfirmDeleteOpen(true)}
              />
              <NewInsideDropdown
                onNewArticle={() => setCreateArticleOpen(true)}
                onNewSubcategory={() => openNewCategoryDialog(currentCategory.id)}
              />
            </>
          ) : (
            <NewAtRootDropdown
              onNewArticle={() => setCreateArticleOpen(true)}
              onNewCategory={() => openNewCategoryDialog(null)}
            />
          )}
        </div>
      </div>

      {/* Sub-categories / top-level categories section */}
      {children.length > 0 && (
        <section className="px-3 pb-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {currentCategory ? 'Sub-categories' : 'Categories'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {children.map((cat) => {
              const descendantCount = allCategories.filter((c) => c.parentId === cat.id).length
              return (
                <HelpCenterSubcategoryCard
                  key={cat.id}
                  category={cat}
                  subCategoryCount={descendantCount}
                  onClick={() => setFilters({ category: cat.id })}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Articles section */}
      <section className="px-3 pb-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {currentCategory
            ? `Articles (${articles.length}${hasNextPage ? '+' : ''})`
            : 'Recent activity'}
        </h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : articles.length === 0 ? (
          <EmptyState
            icon={QuestionMarkCircleIcon}
            title={
              filters.search
                ? 'No articles match your search'
                : currentCategory
                  ? 'No articles in this category yet'
                  : 'No help articles yet'
            }
            className="h-48"
          />
        ) : (
          <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
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
          <div ref={loadMoreRef} className="mt-3 flex justify-center">
            {isFetchingNextPage ? (
              <Spinner />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                className="text-muted-foreground"
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </section>

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
