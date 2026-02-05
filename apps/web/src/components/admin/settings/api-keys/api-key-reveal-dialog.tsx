'use client'

import { SecretRevealDialog } from '@/components/shared/secret-reveal-dialog'

interface ApiKeyRevealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyValue: string | null
  keyName: string
  onClose?: () => void
}

export function ApiKeyRevealDialog({
  open,
  onOpenChange,
  keyValue,
  keyName,
  onClose,
}: ApiKeyRevealDialogProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onClose?.()
    }
    onOpenChange(newOpen)
  }

  return (
    <SecretRevealDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="API Key Created"
      description={
        <>
          Your API key <strong>{keyName}</strong> has been created successfully.
        </>
      }
      secretLabel="Your API Key"
      secretValue={keyValue}
      confirmLabel="I've saved my key"
    >
      {/* Usage example */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Usage</label>
        <div className="rounded-lg bg-muted p-3">
          <code className="text-xs text-muted-foreground block">
            curl -H &quot;Authorization: Bearer {keyValue ? keyValue.slice(0, 20) + '...' : ''}
            &quot; \
            <br />
            &nbsp;&nbsp;https://yoursite.com/api/v1/posts
          </code>
        </div>
      </div>
    </SecretRevealDialog>
  )
}
