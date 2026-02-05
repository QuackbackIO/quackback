'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SecretRevealDialog } from '@/components/shared/secret-reveal-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createWebhookFn } from '@/lib/server/functions/webhooks'
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_CONFIG,
} from '@/lib/server/events/integrations/webhook/constants'

interface CreateWebhookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWebhookDialog({ open, onOpenChange }: CreateWebhookDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  // Form state
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Secret reveal state
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (selectedEvents.length === 0) {
      setError('Select at least one event')
      return
    }

    try {
      const result = await createWebhookFn({
        data: {
          url,
          events: selectedEvents as (typeof WEBHOOK_EVENTS)[number][],
        },
      })

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] })
        router.invalidate()
      })

      // Show secret reveal
      setCreatedSecret(result.secret)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook')
    }
  }

  const handleClose = () => {
    setUrl('')
    setSelectedEvents([])
    setError(null)
    setCreatedSecret(null)
    onOpenChange(false)
  }

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    )
  }

  // Secret reveal view
  if (createdSecret) {
    return (
      <SecretRevealDialog
        open={open}
        onOpenChange={handleClose}
        title="Webhook Created"
        description="Save your signing secret now. You won't be able to see it again."
        secretLabel="Signing Secret"
        secretValue={createdSecret}
        confirmLabel="I've saved my secret"
      >
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Verification:</strong> Each webhook includes an{' '}
            <code className="bg-muted px-1 rounded">X-Quackback-Signature</code> header.
          </p>
          <p>
            Compute{' '}
            <code className="bg-muted px-1 rounded">HMAC-SHA256(timestamp.payload, secret)</code>{' '}
            and compare with the signature.
          </p>
        </div>
      </SecretRevealDialog>
    )
  }

  // Create form view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Webhook</DialogTitle>
          <DialogDescription>
            Configure an endpoint to receive event notifications.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="url">Endpoint URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://example.com/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isPending}
                required
              />
              <p className="text-xs text-muted-foreground">Must be HTTPS in production</p>
            </div>

            <div className="space-y-2">
              <Label>Events</Label>
              <div className="space-y-2">
                {WEBHOOK_EVENT_CONFIG.map((event) => (
                  <label
                    key={event.id}
                    className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => toggleEvent(event.id)}
                      disabled={isPending}
                      className="mt-0.5"
                      aria-label={`Subscribe to ${event.label} events`}
                    />
                    <div>
                      <p className="text-sm font-medium">{event.label}</p>
                      <p className="text-xs text-muted-foreground">{event.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !url || selectedEvents.length === 0}>
              {isPending ? 'Creating...' : 'Create Webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
