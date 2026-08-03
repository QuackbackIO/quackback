import { useState, useRef, useEffect } from 'react'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { saveNtfyFn } from '@/lib/server/integrations/ntfy/functions'

interface NtfyConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function NtfyConnectionActions({ integrationId, isConnected }: NtfyConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (successTimer.current) clearTimeout(successTimer.current)
    },
    []
  )

  const handleSave = async () => {
    if (!url.trim()) return

    setSaving(true)
    setError(null)
    setShowSuccess(false)
    try {
      await saveNtfyFn({
        data: {
          url: url.trim(),
          token: token.trim() || undefined,
        },
      })
      setShowSuccess(true)
      if (successTimer.current) clearTimeout(successTimer.current)
      successTimer.current = setTimeout(() => setShowSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ntfy settings')
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
          title="Disconnect ntfy?"
          description="This will remove the ntfy integration and stop all push notifications. You can reconnect at any time."
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
          <span>ntfy connected and verified!</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ntfy-url" className="text-sm">
            ntfy Topic URL
          </Label>
          <Input
            id="ntfy-url"
            type="url"
            placeholder="https://ntfy.sh/my-topic"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            The full URL of your ntfy topic, e.g. https://ntfy.sh/my-topic
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ntfy-token" className="text-sm">
            Access token
            <span className="ml-1 text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="ntfy-token"
            type="password"
            placeholder="tk_… (optional, for protected topics)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Required only for protected or self-hosted topics
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving || !url.trim()} className="self-start">
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
