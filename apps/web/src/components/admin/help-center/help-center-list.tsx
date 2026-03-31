import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useEffect, startTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { HelpCenterFiltersPanel } from './help-center-filters'
import { useHelpCenterFilters } from './use-help-center-filters'
import { CreateArticleDialog } from './create-article-dialog'
import { HelpCenterListItem } from './help-center-list-item'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { useDeleteArticle } from '@/lib/client/mutations/help-center'
import { Route } from '@/routes/admin/help-center'
import type { HelpCenterArticleId } from '@quackback/ids'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

function ArticleSkeleton() {
  return (
    <div className="p-3">
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
    </div>
  )
}

export function HelpCenterList() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { filters, setFilters, hasActiveFilters } = useHelpCenterFilters()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [articleToDelete, setArticleToDelete] = useState<HelpCenterArticleId | null>(null)

  const deleteArticleMutation = useDeleteArticle()

  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: filters.search,
    onChange: (search) => setFilters({ search }),
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    helpCenterQueries.articleList({
      status: filters.status === 'all' ? undefined : filters.status,
      categoryId: filters.category,
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

  // Keyboard "/" to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          ;(e.target as HTMLElement).blur()
        }
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const articles = data?.pages.flatMap((page) => page.items) ?? []

  const handleEdit = useCallback(
    (id: HelpCenterArticleId) => {
      startTransition(() => {
        navigate({
          to: '/admin/help-center',
          search: { ...search, article: id },
        })
      })
    },
    [navigate, search]
  )

  const handleDelete = (id: HelpCenterArticleId) => {
    setArticleToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (articleToDelete) {
      deleteArticleMutation.mutate(articleToDelete, {
        onSuccess: () => {
          setDeleteDialogOpen(false)
          setArticleToDelete(null)
        },
      })
    }
  }

  return (
    <>
      <InboxLayout
        filters={
          <HelpCenterFiltersPanel
            status={filters.status}
            onStatusChange={(status) => setFilters({ status })}
            category={filters.category}
            onCategoryChange={(category) => setFilters({ category })}
          />
        }
        hasActiveFilters={hasActiveFilters}
      >
        <div className="max-w-5xl mx-auto w-full flex flex-col flex-1 min-h-0">
          <AdminListHeader
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            action={<CreateArticleDialog />}
          />

          {isLoading ? (
            <ArticleSkeleton />
          ) : articles.length === 0 ? (
            <EmptyState
              icon={QuestionMarkCircleIcon}
              title={
                filters.search
                  ? 'No articles match your search'
                  : hasActiveFilters
                    ? 'No articles match your filters'
                    : 'No help articles yet'
              }
              action={!hasActiveFilters && !filters.search ? <CreateArticleDialog /> : undefined}
              className="h-48"
            />
          ) : (
            <div className="p-3">
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
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasNextPage && (
            <div ref={loadMoreRef} className="px-3 pb-3 flex justify-center">
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
        </div>
      </InboxLayout>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete help article?"
        description="This action cannot be undone. The article will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteArticleMutation.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}
