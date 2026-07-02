'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { testWebhookFn } from '@/lib/server/functions/webhooks'
import type { Webhook } from '@/lib/shared/types'

interface TestWebhookDialogProps {
  webhook: Webhook | null
  onOpenChange: (open: boolean) => void
}

interface TestOutcome {
  success: boolean
  errorMessage?: string | null
  eventId: string
}

export function TestWebhookDialog({ webhook, onOpenChange }: TestWebhookDialogProps) {
  const queryClient = useQueryClient()
  const [eventType, setEventType] = useState<string>('')
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!webhook) return null

  const events = webhook.events
  const selectedEvent = eventType || events[0] || ''

  async function handleSend() {
    setPending(true)
    setError(null)
    setOutcome(null)
    try {
      if (!webhook) return
      const result = await testWebhookFn({
        data: { webhookId: webhook.id, eventType: selectedEvent as never },
      })
      setOutcome(result as TestOutcome)
      // refresh deliveries list so the new attempt appears immediately
      void queryClient.invalidateQueries({ queryKey: ['admin', 'webhook-deliveries'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setPending(false)
    }
  }

  function close(open: boolean) {
    if (open) return
    setOutcome(null)
    setError(null)
    setEventType('')
    onOpenChange(false)
  }

  return (
    <Dialog open={!!webhook} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send test event</DialogTitle>
          <DialogDescription>
            Posts a canonical sample payload to{' '}
            <code className="bg-muted px-1 rounded text-xs">{webhook.url}</code> and reports the
            HTTP outcome. The attempt is logged to the deliveries list with an
            <code className="bg-muted mx-1 px-1 rounded text-xs">evt_test_</code>id so receivers can
            ignore it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="test-event-type">Event type</Label>
            <Select value={selectedEvent} onValueChange={setEventType}>
              <SelectTrigger id="test-event-type">
                <SelectValue placeholder="Choose an event" />
              </SelectTrigger>
              <SelectContent>
                {events.map((ev) => (
                  <SelectItem key={ev} value={ev}>
                    {ev}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {outcome && (
            <div
              className={
                'flex items-start gap-2 rounded-md border p-3 text-sm ' +
                (outcome.success
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                  : 'border-destructive/40 bg-destructive/5 text-destructive')
              }
            >
              {outcome.success ? (
                <CheckCircleIcon className="h-5 w-5 shrink-0" />
              ) : (
                <XCircleIcon className="h-5 w-5 shrink-0" />
              )}
              <div className="space-y-0.5">
                <p className="font-medium">
                  {outcome.success ? 'Delivered successfully' : 'Delivery failed'}
                </p>
                <p className="text-xs">Event id: {outcome.eventId}</p>
                {outcome.errorMessage && <p className="text-xs">{outcome.errorMessage}</p>}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            Close
          </Button>
          <Button onClick={handleSend} disabled={pending || !selectedEvent}>
            {pending ? 'Sending…' : 'Send test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
