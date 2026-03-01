'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useEffect, useMemo, startTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { ChangelogFiltersPanel } from './changelog-filters'
import { useChangelogFilters } from './use-changelog-filters'
import { CreateChangelogDialog } from './create-changelog-dialog'
import { ChangelogListItem } from './changelog-list-item'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { useDeleteChangelog } from '@/lib/client/mutations/changelog'
import { Route } from '@/routes/admin/changelog'
import type { ChangelogId } from '@quackback/ids'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

function ChangelogSkeleton() {
  return (
    <div className="p-3">
      <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
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

export function ChangelogList() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { filters, setFilters, hasActiveFilters } = useChangelogFilters()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entryToDelete, setEntryToDelete] = useState<ChangelogId | null>(null)

  const deleteChangelogMutation = useDeleteChangelog()

  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: filters.search,
    onChange: (search) => setFilters({ search }),
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    changelogQueries.list({ status: filters.status })
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

  const allEntries = data?.pages.flatMap((page) => page.items) ?? []

  // Client-side search filtering
  const entries = useMemo(() => {
    if (!filters.search) return allEntries
    const q = filters.search.toLowerCase()
    return allEntries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.author?.name.toLowerCase().includes(q)
    )
  }, [allEntries, filters.search])

  // Navigate to entry via URL for shareable links
  const handleEdit = useCallback(
    (id: ChangelogId) => {
      startTransition(() => {
        navigate({
          to: '/admin/changelog',
          search: { ...search, entry: id },
        })
      })
    },
    [navigate, search]
  )

  const handleDelete = (id: ChangelogId) => {
    setEntryToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (entryToDelete) {
      deleteChangelogMutation.mutate(entryToDelete, {
        onSuccess: () => {
          setDeleteDialogOpen(false)
          setEntryToDelete(null)
        },
      })
    }
  }

  return (
    <>
      <InboxLayout
        filters={
          <ChangelogFiltersPanel
            status={filters.status}
            onStatusChange={(status) => setFilters({ status })}
          />
        }
        hasActiveFilters={hasActiveFilters}
      >
        <div className="max-w-5xl mx-auto w-full flex flex-col flex-1 min-h-0">
          {/* Header */}
          <AdminListHeader
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            action={<CreateChangelogDialog />}
          />

          {/* List */}
          {isLoading ? (
            <ChangelogSkeleton />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={DocumentTextIcon}
              title={
                filters.search
                  ? 'No changelog entries match your search'
                  : hasActiveFilters
                    ? 'No changelog entries match your filters'
                    : 'No changelog entries yet'
              }
              action={!hasActiveFilters && !filters.search ? <CreateChangelogDialog /> : undefined}
              className="h-48"
            />
          ) : (
            <div className="p-3">
              <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
                {entries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                    style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                  >
                    <ChangelogListItem
                      id={entry.id}
                      title={entry.title}
                      content={entry.content}
                      status={entry.status}
                      publishedAt={entry.publishedAt}
                      createdAt={entry.createdAt}
                      author={entry.author}
                      linkedPosts={entry.linkedPosts}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Infinite scroll trigger */}
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

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete changelog entry?"
        description="This action cannot be undone. The changelog entry will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteChangelogMutation.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}
