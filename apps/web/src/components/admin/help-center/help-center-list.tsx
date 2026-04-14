import { useState, useCallback, useEffect, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { HelpCenterFiltersPanel } from './help-center-filters'
import { HelpCenterFinder } from './help-center-finder'
import { useHelpCenterFilters } from './use-help-center-filters'
import type { HelpCenterStatusFilter } from './use-help-center-filters'
import { useDeleteArticle } from '@/lib/client/mutations/help-center'
import { Route } from '@/routes/admin/help-center'
import type { HelpCenterArticleId } from '@quackback/ids'

export function HelpCenterList() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { filters, setFilters, hasActiveFilters } = useHelpCenterFilters()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [articleToDelete, setArticleToDelete] = useState<HelpCenterArticleId | null>(null)

  const deleteArticleMutation = useDeleteArticle()

  // Keyboard "/" to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        if (e.key === 'Escape') {
          target.blur()
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

  const handleEdit = useCallback(
    (id: HelpCenterArticleId) => {
      startTransition(() => {
        void navigate({
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
            onStatusChange={(status) => setFilters({ status: status as HelpCenterStatusFilter })}
          />
        }
        hasActiveFilters={hasActiveFilters}
      >
        <HelpCenterFinder onEditArticle={handleEdit} onDeleteArticle={handleDelete} />
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
