'use client'

import { useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { saveShortcutTokenFn } from '@/integrations/shortcut/server/functions'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { useQueryClient } from '@tanstack/react-query'

interface ShortcutConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function ShortcutConnectionActions({
  integrationId,
  isConnected,
}: ShortcutConnectionActionsProps) {
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteIntegration()
  const [apiToken, setApiToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleSaveToken = async () => {
    if (!apiToken.trim()) return
    setSaving(true)
    setError(null)
    try {
      await saveShortcutTokenFn({ data: { apiToken: apiToken.trim() } })
      setApiToken('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API token')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = () => {
    if (!integrationId) return
    deleteMutation.mutate({ id: integrationId })
  }

  const disconnecting = deleteMutation.isPending

  return (
    <>
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!isConnected && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="shortcut-token" className="text-sm">
            API Token
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="shortcut-token"
              type="password"
              placeholder="Paste your Shortcut API token"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              disabled={saving}
              className="w-64"
            />
            <Button onClick={handleSaveToken} disabled={saving || !apiToken.trim()}>
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
      )}

      {isConnected && (
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
            title="Disconnect Shortcut?"
            description="This will remove the Shortcut integration and stop all story syncing. You can reconnect at any time."
            confirmLabel="Disconnect"
            isPending={disconnecting}
            onConfirm={handleDisconnect}
          />
        </div>
      )}
    </>
  )
}
