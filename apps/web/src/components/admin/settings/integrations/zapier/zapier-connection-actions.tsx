import { useState } from 'react'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { saveZapierWebhookFn } from '@/lib/server/integrations/zapier/functions'
import { useDeleteIntegration } from '@/lib/client/mutations'

interface ZapierConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  webhookUrl?: string
}

export function ZapierConnectionActions({
  integrationId,
  isConnected,
  webhookUrl,
}: ZapierConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const [url, setUrl] = useState(webhookUrl || '')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleSave = async () => {
    if (!url.trim()) return

    setSaving(true)
    setError(null)
    setShowSuccess(false)
    try {
      await saveZapierWebhookFn({ data: { webhookUrl: url.trim() } })
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 3000)
      return () => clearTimeout(timer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save webhook URL')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = () => {
    if (!integrationId) return
    deleteMutation.mutate({ id: integrationId })
  }

  const disconnecting = deleteMutation.isPending

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disconnecting}
          onClick={() => setDisconnectDialogOpen(true)}
        >
          {disconnecting ? (
            <>
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              Disconnecting...
            </>
          ) : (
            'Disconnect'
          )}
        </Button>
        <ConfirmDialog
          open={disconnectDialogOpen}
          onOpenChange={setDisconnectDialogOpen}
          title="Disconnect Zapier?"
          description="This will remove the Zapier integration and stop all webhook notifications. You can reconnect at any time."
          confirmLabel="Disconnect"
          isPending={disconnecting}
          onConfirm={handleDisconnect}
        />
      </div>
    )
  }

  return (
    <>
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircleIcon className="h-4 w-4" />
          <span>Webhook saved and verified!</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="webhook-url" className="text-sm">
          Webhook URL
        </Label>
        <div className="flex gap-2">
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://hooks.zapier.com/hooks/catch/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={saving}
            className="flex-1"
          />
          <Button onClick={handleSave} disabled={saving || !url.trim()}>
            {saving ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
