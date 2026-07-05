'use client'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteConnector } from '@/lib/client/mutations/connectors'
import type { DataConnector } from '@/lib/server/domains/connectors/connector.types'

interface DeleteConnectorDialogProps {
  connector: DataConnector
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteConnectorDialog({ connector, open, onOpenChange }: DeleteConnectorDialogProps) {
  const del = useDeleteConnector()

  const handleDelete = () => {
    del.mutate(connector.id, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete connector"
      description="Are you sure you want to delete this connector?"
      warning={{
        title: 'This action cannot be undone',
        description: (
          <>
            <code className="bg-muted px-1 rounded text-xs">{connector.name}</code> will be
            permanently deleted and removed as a tool for the assistant.
          </>
        ),
      }}
      variant="destructive"
      confirmLabel={del.isPending ? 'Deleting...' : 'Delete connector'}
      isPending={del.isPending}
      onConfirm={handleDelete}
    >
      {del.isError && (
        <p className="text-sm text-destructive">
          {del.error instanceof Error ? del.error.message : 'Failed to delete connector'}
        </p>
      )}
    </ConfirmDialog>
  )
}
