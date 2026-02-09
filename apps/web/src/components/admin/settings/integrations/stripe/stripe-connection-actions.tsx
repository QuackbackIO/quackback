import { useState } from 'react'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { saveStripeKeyFn } from '@/lib/server/integrations/stripe/functions'
import { useDeleteIntegration } from '@/lib/client/mutations'

interface StripeConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  apiKey?: string
}

export function StripeConnectionActions({
  integrationId,
  isConnected,
  apiKey,
}: StripeConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const [key, setKey] = useState(apiKey || '')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleSave = async () => {
    if (!key.trim()) return

    setSaving(true)
    setError(null)
    setShowSuccess(false)
    try {
      await saveStripeKeyFn({ data: { apiKey: key.trim() } })
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 3000)
      return () => clearTimeout(timer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key')
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
          title="Disconnect Stripe?"
          description="This will remove the Stripe integration and stop all payment event synchronization. You can reconnect at any time."
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
          <span>API key saved and verified!</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="api-key" className="text-sm">
          Stripe API Key
        </Label>
        <div className="flex gap-2">
          <Input
            id="api-key"
            type="password"
            placeholder="sk_live_... or rk_live_..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={saving}
            className="flex-1"
          />
          <Button onClick={handleSave} disabled={saving || !key.trim()}>
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
        <p className="text-xs text-muted-foreground">
          Use a restricted API key with read-only access to customer and payment data.
        </p>
      </div>
    </>
  )
}
