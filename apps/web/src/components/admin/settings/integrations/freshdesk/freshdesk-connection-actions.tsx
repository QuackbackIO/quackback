import { useState } from 'react'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { saveFreshdeskKeyFn } from '@/lib/server/integrations/freshdesk/functions'
import { useDeleteIntegration } from '@/lib/client/mutations'

interface FreshdeskConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  subdomain?: string
}

export function FreshdeskConnectionActions({
  integrationId,
  isConnected,
  subdomain,
}: FreshdeskConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const [subdomainValue, setSubdomainValue] = useState(subdomain || '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleSave = async () => {
    if (!subdomainValue.trim() || !apiKey.trim()) return

    setSaving(true)
    setError(null)
    setShowSuccess(false)
    try {
      await saveFreshdeskKeyFn({
        data: {
          subdomain: subdomainValue.trim(),
          apiKey: apiKey.trim(),
        },
      })
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 3000)
      return () => clearTimeout(timer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials')
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
          title="Disconnect Freshdesk?"
          description="This will remove the Freshdesk integration and stop all ticket synchronization. You can reconnect at any time."
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
          <span>Credentials saved and verified!</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="subdomain" className="text-sm">
            Freshdesk Subdomain
          </Label>
          <Input
            id="subdomain"
            type="text"
            placeholder="yourcompany"
            value={subdomainValue}
            onChange={(e) => setSubdomainValue(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            The subdomain from your Freshdesk URL (e.g., yourcompany.freshdesk.com)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key" className="text-sm">
            Freshdesk API Key
          </Label>
          <Input
            id="api-key"
            type="password"
            placeholder="Your Freshdesk API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Find your API key in Freshdesk under Profile Settings → API Key
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving || !subdomainValue.trim() || !apiKey.trim()}>
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
    </>
  )
}
