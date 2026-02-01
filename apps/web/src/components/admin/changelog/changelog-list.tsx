'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { ChangelogFiltersPanel } from './changelog-filters'
import { useChangelogFilters } from './use-changelog-filters'
import { CreateChangelogDialog } from './create-changelog-dialog'
import { EditChangelogDialog } from './edit-changelog-dialog'
import { ChangelogListItem } from './changelog-list-item'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { useDeleteChangelog } from '@/lib/client/mutations/changelog'
import type { ChangelogId } from '@quackback/ids'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

export function ChangelogList() {
  const { filters, setFilters, hasActiveFilters } = useChangelogFilters()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entryToDelete, setEntryToDelete] = useState<ChangelogId | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [entryToEdit, setEntryToEdit] = useState<ChangelogId | null>(null)

  const deleteChangelogMutation = useDeleteChangelog()

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    changelogQueries.list({ status: filters.status })
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

  const handleEdit = (id: ChangelogId) => {
    setEntryToEdit(id)
    setEditDialogOpen(true)
  }

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
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <DocumentTextIcon className="h-12 w-12 text-muted-foreground/30" />
                <div className="text-sm text-muted-foreground">
                  {hasActiveFilters
                    ? 'No changelog entries match your filters'
                    : 'No changelog entries yet'}
                </div>
                {!hasActiveFilters && <CreateChangelogDialog />}
              </div>
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
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete changelog entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The changelog entry will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteChangelogMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteChangelogMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteChangelogMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog */}
      {entryToEdit && (
        <EditChangelogDialog
          id={entryToEdit}
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open)
            if (!open) {
              setEntryToEdit(null)
            }
          }}
        />
      )}
    </>
  )
}
