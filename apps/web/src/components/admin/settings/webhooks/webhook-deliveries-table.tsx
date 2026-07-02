/**
 * Webhook deliveries table — cursor-paged list of attempts. Status filter
 * passed in by the parent drawer; rows expand to show request URL, response
 * snippet, error message, and retry metadata.
 */
import { Fragment, useState, useMemo } from 'react'
import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import type { WebhookId } from '@quackback/ids'
import {
  webhookDeliveryQueries,
  type WebhookDeliveryStatusFilter,
} from '@/lib/client/queries/webhook-deliveries'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'

interface Props {
  webhookId: WebhookId
  status?: WebhookDeliveryStatusFilter
}

type DeliveryRow = {
  id: string
  webhookId: string
  eventId: string
  eventType: string
  attemptNumber: number
  status: string
  httpStatus: number | null
  errorMessage: string | null
  requestUrl: string
  requestPayloadBytes: number
  responseBodySnippet: string | null
  latencyMs: number | null
  signatureTimestamp: number
  attemptedAt: string
  nextRetryAt: string | null
}

function StatusPill({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200">
          Success
        </Badge>
      )
    case 'failed_retryable':
      return (
        <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200">
          Retrying
        </Badge>
      )
    case 'failed_terminal':
      return <Badge variant="destructive">Failed</Badge>
    case 'blocked_ssrf':
      return (
        <Badge variant="outline" className="border-destructive text-destructive">
          Blocked (SSRF)
        </Badge>
      )
    case 'queued':
      return <Badge variant="secondary">Queued</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function WebhookDeliveriesTable({ webhookId, status }: Props) {
  const query = useSuspenseInfiniteQuery(webhookDeliveryQueries.list(webhookId, { status }))
  const rows = useMemo<DeliveryRow[]>(
    () => query.data.pages.flatMap((p) => p.deliveries as DeliveryRow[]),
    [query.data]
  )

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-44">Attempted at</TableHead>
              <TableHead className="w-16">#</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-16">HTTP</TableHead>
              <TableHead className="w-20">Latency</TableHead>
              <TableHead>Event</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                  No deliveries recorded for this webhook yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const isOpen = expanded.has(row.id)
                return (
                  <Fragment key={row.id}>
                    <TableRow className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          type="button"
                          aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                          onClick={() => toggle(row.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDownIcon className="h-4 w-4" />
                          ) : (
                            <ChevronRightIcon className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={new Date(row.attemptedAt).toISOString()}
                      >
                        {new Date(row.attemptedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.attemptNumber}</TableCell>
                      <TableCell>
                        <StatusPill status={row.status} />
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.httpStatus ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.latencyMs != null ? `${row.latencyMs}ms` : '—'}
                      </TableCell>
                      <TableCell>
                        <code className="text-[11px] bg-muted/40 px-1.5 py-0.5 rounded">
                          {row.eventType}
                        </code>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell />
                        <TableCell colSpan={6} className="py-3">
                          <DeliveryDetail row={row} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{rows.length} deliveries shown</span>
        {query.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  )
}

function DeliveryDetail({ row }: { row: DeliveryRow }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Request URL" mono value={row.requestUrl} />
        <Field label="Event ID" mono value={row.eventId} />
        <Field label="Payload size" value={`${row.requestPayloadBytes} bytes`} />
        <Field
          label="Signature timestamp"
          mono
          value={`${row.signatureTimestamp} (${new Date(row.signatureTimestamp * 1000).toISOString()})`}
        />
        {row.nextRetryAt && (
          <Field label="Next retry" value={new Date(row.nextRetryAt).toLocaleString()} />
        )}
      </div>

      {row.errorMessage && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
            Error
          </div>
          <pre className="text-[11px] bg-destructive/10 text-destructive rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {row.errorMessage}
          </pre>
        </div>
      )}

      {row.responseBodySnippet && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Response body (snippet)
          </div>
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
            {row.responseBodySnippet}
          </pre>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-[11px] truncate ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}
