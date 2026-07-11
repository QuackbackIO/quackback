'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  WEBHOOK_EVENT_CATEGORIES,
  WEBHOOK_EVENT_CONFIG,
  type WebhookEventCategory,
} from '@/lib/shared/webhook-events'
import { fetchSamplePayloadsFn } from '@/lib/server/functions/webhooks'

interface WebhookEventPickerProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

/**
 * Grouped event picker shared by the create + edit webhook dialogs.
 *
 * Renders one section per `WEBHOOK_EVENT_CATEGORIES` entry with a
 * "Select all" / "Clear" pair scoped to that category. Categories with no
 * events (shouldn't happen given the static config, but defensive) are
 * skipped.
 */
export function WebhookEventPicker({ value, onChange, disabled }: WebhookEventPickerProps) {
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set())
  const samplesQuery = useQuery({
    queryKey: ['admin', 'webhook-sample-payloads'],
    queryFn: () => fetchSamplePayloadsFn(),
    enabled: previewIds.size > 0,
    staleTime: Infinity,
  })

  const togglePreview = (eventId: string) => {
    setPreviewIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  const toggleEvent = (eventId: string) => {
    onChange(value.includes(eventId) ? value.filter((e) => e !== eventId) : [...value, eventId])
  }

  const selectAllInCategory = (category: WebhookEventCategory) => {
    const ids = WEBHOOK_EVENT_CONFIG.filter((e) => e.category === category).map((e) => e.id)
    const merged = Array.from(new Set([...value, ...ids]))
    onChange(merged)
  }

  const clearCategory = (category: WebhookEventCategory) => {
    const ids = new Set<string>(
      WEBHOOK_EVENT_CONFIG.filter((e) => e.category === category).map((e) => e.id)
    )
    onChange(value.filter((id) => !ids.has(id)))
  }

  return (
    <div className="space-y-2">
      <Label>Events</Label>
      <div className="space-y-4">
        {WEBHOOK_EVENT_CATEGORIES.map((category) => {
          const events = WEBHOOK_EVENT_CONFIG.filter((e) => e.category === category.id)
          if (events.length === 0) return null
          const selectedInCategory = events.filter((e) => value.includes(e.id)).length
          return (
            <div key={category.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.label}
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    ({selectedInCategory}/{events.length})
                  </span>
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    onClick={() => selectAllInCategory(category.id)}
                    disabled={disabled || selectedInCategory === events.length}
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground/50">·</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    onClick={() => clearCategory(category.id)}
                    disabled={disabled || selectedInCategory === 0}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {events.map((event) => {
                  const isPreviewOpen = previewIds.has(event.id)
                  const samples = samplesQuery.data as Record<string, unknown> | undefined
                  const sample = samples?.[event.id]
                  return (
                    <div
                      key={event.id}
                      className="rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3 p-3">
                        <Checkbox
                          checked={value.includes(event.id)}
                          onCheckedChange={() => toggleEvent(event.id)}
                          disabled={disabled}
                          className="mt-0.5"
                          aria-label={`Subscribe to ${event.label} events`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{event.label}</p>
                          <p className="text-xs text-muted-foreground">{event.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePreview(event.id)}
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                          aria-expanded={isPreviewOpen}
                          aria-label={`${isPreviewOpen ? 'Hide' : 'Show'} sample payload for ${event.label}`}
                        >
                          {isPreviewOpen ? (
                            <ChevronDownIcon className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRightIcon className="h-3.5 w-3.5" />
                          )}
                          Sample
                        </button>
                      </div>
                      {isPreviewOpen && (
                        <div className="border-t bg-muted/30 px-3 py-2">
                          {samplesQuery.isLoading ? (
                            <p className="text-[11px] text-muted-foreground">Loading…</p>
                          ) : sample ? (
                            <pre className="text-[11px] overflow-x-auto whitespace-pre max-h-64">
                              {JSON.stringify(sample, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              No sample available for this event.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
