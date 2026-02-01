'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { CreateChangelogDialog } from './create-changelog-dialog'
import { ChangelogListItem } from './changelog-list-item'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { useDeleteChangelog } from '@/lib/client/mutations/changelog'
import type { ChangelogId } from '@quackback/ids'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

type StatusFilter = 'all' | 'draft' | 'scheduled' | 'published'

export function ChangelogList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entryToDelete, setEntryToDelete] = useState<ChangelogId | null>(null)

  const deleteChangelogMutation = useDeleteChangelog()

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    changelogQueries.list({ status: statusFilter })
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

  const handleEdit = (id: ChangelogId) => {
    // TODO: Implement edit dialog or navigation
    console.log('Edit changelog:', id)
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b bg-card/50">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Changelog</h1>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All statuses
              </SelectItem>
              <SelectItem value="draft" className="text-xs">
                Draft
              </SelectItem>
              <SelectItem value="scheduled" className="text-xs">
                Scheduled
              </SelectItem>
              <SelectItem value="published" className="text-xs">
                Published
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateChangelogDialog />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <DocumentTextIcon className="h-12 w-12 text-muted-foreground/30" />
            <div className="text-sm text-muted-foreground">No changelog entries yet</div>
            <CreateChangelogDialog />
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
    </div>
  )
}
