'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, useCallback, startTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { ChangelogFiltersPanel } from './changelog-filters'
import { useChangelogFilters } from './use-changelog-filters'
import { CreateChangelogDialog } from './create-changelog-dialog'
import { ChangelogListItem } from './changelog-list-item'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { useDeleteChangelog } from '@/lib/client/mutations/changelog'
import { Route } from '@/routes/admin/changelog'
import type { ChangelogId } from '@quackback/ids'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

export function ChangelogList() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { filters, setFilters, hasActiveFilters } = useChangelogFilters()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entryToDelete, setEntryToDelete] = useState<ChangelogId | null>(null)

  const deleteChangelogMutation = useDeleteChangelog()

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    changelogQueries.list({ status: filters.status })
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

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
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b bg-card/50">
            <h1 className="text-lg font-semibold">Changelog</h1>
            <CreateChangelogDialog />
          </div>

          {/* List */}
          <div className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="text-sm text-muted-foreground">Loading...</div>
              </div>
            ) : entries.length === 0 ? (
              <EmptyState
                icon={DocumentTextIcon}
                title={
                  hasActiveFilters
                    ? 'No changelog entries match your filters'
                    : 'No changelog entries yet'
                }
                action={!hasActiveFilters ? <CreateChangelogDialog /> : undefined}
                className="h-48"
              />
            ) : (
              <>
                {entries.map((entry) => (
                  <ChangelogListItem
                    key={entry.id}
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
                ))}

                {/* Load more */}
                {hasNextPage && (
                  <div className="flex justify-center py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? 'Loading...' : 'Load more'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
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
