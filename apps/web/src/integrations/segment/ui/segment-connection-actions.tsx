import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { saveSegmentConnectionFn } from '@/lib/server/functions/segment-integration'

export function SegmentConnectionActions(props: { integrationId?: string; isConnected: boolean }) {
  const [incomingSecret, setIncomingSecret] = useState('')
  const [writeKey, setWriteKey] = useState('')
  const [outgoingEnabled, setOutgoingEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteMutation = useDeleteIntegration()

  if (props.isConnected) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
          Disconnect
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Disconnect Segment?"
          description="Inbound identify events and outbound membership sync will stop immediately."
          confirmLabel="Disconnect"
          isPending={deleteMutation.isPending}
          onConfirm={() => {
            if (props.integrationId) deleteMutation.mutate({ id: props.integrationId })
          }}
        />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="segment-incoming-secret">Inbound signing secret</Label>
        <Input
          id="segment-incoming-secret"
          type="password"
          autoComplete="new-password"
          value={incomingSecret}
          onChange={(event) => setIncomingSecret(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="segment-write-key">Source write key (optional)</Label>
        <Input
          id="segment-write-key"
          type="password"
          autoComplete="new-password"
          value={writeKey}
          onChange={(event) => setWriteKey(event.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox
          checked={outgoingEnabled}
          onCheckedChange={(checked) => setOutgoingEnabled(checked === true)}
        />
        Push segment membership changes back to Segment
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        disabled={saving || incomingSecret.trim().length < 16}
        onClick={async () => {
          setSaving(true)
          setError(null)
          try {
            await saveSegmentConnectionFn({
              data: {
                incomingSecret: incomingSecret.trim(),
                writeKey: writeKey.trim() || undefined,
                outgoingEnabled,
              },
            })
            window.location.reload()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to connect Segment')
          } finally {
            setSaving(false)
          }
        }}
      >
        {saving ? 'Saving…' : 'Connect Segment'}
      </Button>
    </div>
  )
}
