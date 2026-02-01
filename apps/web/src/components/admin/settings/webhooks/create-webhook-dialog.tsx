'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  ClipboardDocumentIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
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
import { createWebhookFn } from '@/lib/server-functions/webhooks'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_CONFIG } from '@/lib/events/integrations/webhook/constants'

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
  const [copied, setCopied] = useState(false)

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

  const handleCopySecret = async () => {
    if (createdSecret) {
      await navigator.clipboard.writeText(createdSecret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleClose = () => {
    setUrl('')
    setSelectedEvents([])
    setError(null)
    setCreatedSecret(null)
    setCopied(false)
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
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Webhook Created</DialogTitle>
            <DialogDescription>
              Save your signing secret now. You won't be able to see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Copy this secret now
                </p>
                <p className="text-muted-foreground mt-1">
                  This is the only time you'll see this secret. Use it to verify webhook signatures.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Signing Secret</Label>
              <div className="flex gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                  {createdSecret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopySecret}
                  aria-label="Copy secret to clipboard"
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4 text-green-600" />
                  ) : (
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Verification:</strong> Each webhook includes an{' '}
                <code className="bg-muted px-1 rounded">X-Quackback-Signature</code> header.
              </p>
              <p>
                Compute{' '}
                <code className="bg-muted px-1 rounded">
                  HMAC-SHA256(timestamp.payload, secret)
                </code>{' '}
                and compare with the signature.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>I've saved my secret</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
