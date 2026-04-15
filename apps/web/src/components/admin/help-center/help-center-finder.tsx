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
import { ChevronRightIcon } from '@heroicons/react/16/solid'
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
import { cn } from '@/lib/shared/utils'
import { HelpCenterListItem } from './help-center-list-item'
import { CreateArticleDialog } from './create-article-dialog'
import type { CategoryActions } from './help-center-category-tree'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { useRestoreCategory, useRestoreArticle } from '@/lib/client/mutations/help-center'
import { buildAncestorChain } from '@/lib/server/domains/help-center/category-tree'
import { useHelpCenterFilters } from './use-help-center-filters'
import { HelpCenterActiveFiltersBar } from './help-center-active-filters-bar'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { TimeAgo } from '@/components/ui/time-ago'
import type { HelpCenterArticleId } from '@quackback/ids'

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
  categoryActions: CategoryActions
}

export function HelpCenterFinder(props: HelpCenterFinderProps) {
  const { filters } = useHelpCenterFilters()

  if (filters.showDeleted) {
    return <DeletedItemsView />
  }

  return <LiveHelpCenterFinder {...props} />
}

function LiveHelpCenterFinder({
  onEditArticle,
  onDeleteArticle,
  categoryActions,
}: HelpCenterFinderProps) {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useHelpCenterFilters()

  const [createArticleOpen, setCreateArticleOpen] = useState(false)

  const { data: allCategories = [] } = useQuery(helpCenterQueries.categories())

  const currentCategory = useMemo(
    () => allCategories.find((c) => c.id === filters.category),
    [allCategories, filters.category]
  )

  // Direct children of the currently-selected category (or top-level at root).
  const directChildren = useMemo(() => {
    if (!filters.category) {
      return allCategories.filter((c) => c.parentId === null)
    }
    return allCategories.filter((c) => c.parentId === filters.category)
  }, [allCategories, filters.category])

  // Ancestor chain (top-level → current) for breadcrumbs.
  const ancestorChain = useMemo(() => {
    if (!filters.category) return []
    return buildAncestorChain(allCategories, filters.category)
  }, [allCategories, filters.category])

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
  })

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage && !!filters.category,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const articles = data?.pages.flatMap((page) => page.items) ?? []

  const headerActions = currentCategory ? (
    <div className="flex items-center gap-1">
      <CategoryActionsDropdown
        onEdit={() => categoryActions.onEdit(currentCategory)}
        onDelete={() => categoryActions.onDelete(currentCategory)}
      />
      <NewInsideDropdown
        onNewArticle={() => setCreateArticleOpen(true)}
        onNewSubcategory={() => categoryActions.onNew(currentCategory.id)}
      />
    </div>
  ) : (
    <NewAtRootDropdown
      onNewArticle={() => setCreateArticleOpen(true)}
      onNewCategory={() => categoryActions.onNew(null)}
    />
  )

  const articleListTitle = currentCategory
    ? `Articles in ${currentCategory.name}`
    : 'Recent articles'

  return (
    <div className="max-w-5xl mx-auto w-full">
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
        <HelpCenterActiveFiltersBar
          status={filters.status}
          category={filters.category}
          showDeleted={filters.showDeleted}
          onClearStatus={() => setFilters({ status: 'all' })}
          onClearCategory={() => setFilters({ category: undefined })}
          onClearShowDeleted={() => setFilters({ showDeleted: undefined })}
          onClearAll={clearFilters}
        />
      </AdminListHeader>

      <div className="px-3 pb-4 space-y-3">
        {/* Breadcrumbs — only when a category is selected */}
        {ancestorChain.length > 0 && (
          <BreadcrumbRow
            chain={ancestorChain}
            onNavigate={(id) => setFilters({ category: id ?? undefined })}
          />
        )}

        {/* Sub-category chip row — lateral nav */}
        <SubCategoryChipRow
          categories={directChildren}
          onNavigate={(id) => setFilters({ category: id })}
          onNew={() => categoryActions.onNew(currentCategory?.id ?? null)}
          canAddSub={!currentCategory || ancestorChain.length < 3}
        />

        {/* Article list */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {articleListTitle}
            </span>
            {!isLoading && articles.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {articles.length}
                {hasNextPage && filters.category ? '+' : ''} article
                {articles.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="p-3">
              <HelpCenterListSkeleton />
            </div>
          ) : articles.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                icon={QuestionMarkCircleIcon}
                title={
                  filters.search
                    ? 'No articles match your search'
                    : hasActiveFilters
                      ? 'No articles match your filters'
                      : currentCategory
                        ? 'No articles in this category yet'
                        : 'No articles yet'
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear all filters
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setCreateArticleOpen(true)}>
                      <PlusIcon className="h-4 w-4 mr-1" />
                      New article
                    </Button>
                  )
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
          <div ref={loadMoreRef} />
          {filters.category && hasNextPage && (
            <div className="border-t border-border/50">
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

      <CreateArticleDialog open={createArticleOpen} onOpenChange={setCreateArticleOpen} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Breadcrumb row
// ---------------------------------------------------------------------------

interface BreadcrumbRowProps {
  chain: ReadonlyArray<{ id: string; name: string }>
  onNavigate: (id: string | null) => void
}

function BreadcrumbRow({ chain, onNavigate }: BreadcrumbRowProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap"
    >
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="hover:text-foreground transition-colors"
      >
        Help Center
      </button>
      {chain.map((cat, index) => {
        const isLast = index === chain.length - 1
        return (
          <span key={cat.id} className="flex items-center gap-1">
            <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            {isLast ? (
              <span className="text-foreground font-medium truncate max-w-[200px]">{cat.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(cat.id)}
                className="hover:text-foreground transition-colors truncate max-w-[160px]"
              >
                {cat.name}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Sub-category chip row
// ---------------------------------------------------------------------------

interface SubCategoryChipRowProps {
  categories: ReadonlyArray<{
    id: string
    name: string
    icon: string | null
    articleCount: number
  }>
  onNavigate: (id: string) => void
  onNew: () => void
  canAddSub: boolean
}

function SubCategoryChipRow({ categories, onNavigate, onNew, canAddSub }: SubCategoryChipRowProps) {
  if (categories.length === 0 && !canAddSub) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onNavigate(cat.id)}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs',
            'bg-muted text-foreground/80 hover:bg-muted/70 hover:text-foreground',
            'transition-colors'
          )}
        >
          {cat.icon && <span className="text-sm leading-none">{cat.icon}</span>}
          <span className="truncate max-w-[160px]">{cat.name}</span>
          <span className="text-muted-foreground tabular-nums">{cat.articleCount}</span>
        </button>
      ))}
      {canAddSub && (
        <button
          type="button"
          onClick={onNew}
          className={cn(
            'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs',
            'border border-dashed border-border/50 text-muted-foreground',
            'hover:text-foreground hover:border-border hover:bg-muted/30 transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          New {categories.length === 0 ? 'category' : 'sub-category'}
        </button>
      )}
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

  return (
    <div className="max-w-5xl mx-auto w-full">
      <AdminListHeader searchValue="" onSearchChange={() => {}} searchPlaceholder="Deleted items" />

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
// Header sub-components
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
