/**
 * Admin audit-log feed. Renders a paginated table of recent security-
 * sensitive actions with filters (event type, outcome, time range)
 * and a CSV export of the currently-filtered window.
 */
import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowDownTrayIcon } from '@heroicons/react/24/solid'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { adminQueries } from '@/lib/client/queries/admin'
import type { AuditEventRow } from '@/lib/server/functions/audit-log'

/**
 * Event-type catalog for the filter dropdown. Mirrors the
 * AuditEventType union — sourced from the server to keep the two in
 * lockstep would be neat, but a curated short list is friendlier for
 * the dropdown.
 */
const FILTER_EVENT_TYPES = [
  { label: 'All events', value: 'all' },
  { label: 'SSO enforcement enabled (domain)', value: 'sso.enforcement.domain.enabled' },
  { label: 'SSO enforcement disabled (domain)', value: 'sso.enforcement.domain.disabled' },
  { label: 'SSO config changed', value: 'sso.config.changed' },
  { label: 'Password sign-in enabled', value: 'auth.password.enabled' },
  { label: 'Password sign-in disabled', value: 'auth.password.disabled' },
  { label: 'Email sign-in enabled', value: 'auth.magic_link.enabled' },
  { label: 'Email sign-in disabled', value: 'auth.magic_link.disabled' },
  { label: 'Two-factor reset by admin', value: 'two_factor.reset_by_admin' },
] as const

const TIME_RANGES = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'All time', value: 'all' },
] as const

type TimeRange = (typeof TIME_RANGES)[number]['value']

/**
 * Convert the time-range pick to a stable ISO timestamp. Stable in
 * two senses: (1) rounded to the start of the current minute so two
 * calls within 60s produce the same string, which keeps the loader
 * prefetch and the component's mount call landing on the same React
 * Query cache entry; (2) idempotent for repeated calls with the same
 * range in the same minute.
 */
export function rangeToFromIso(range: TimeRange): string | undefined {
  if (range === 'all') return undefined
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  // Floor to the minute so SSR + hydrate land on the same query key.
  const minuteMs = 60 * 1000
  const now = Math.floor(Date.now() / minuteMs) * minuteMs
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function rowsToCsv(rows: AuditEventRow[]): string {
  const headers = [
    'occurred_at',
    'event_type',
    'outcome',
    'actor_email',
    'actor_role',
    'actor_ip',
    'target_type',
    'target_id',
    'metadata',
  ]
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.occurredAt,
        r.eventType,
        r.eventOutcome,
        r.actorEmail,
        r.actorRole,
        r.actorIp,
        r.targetType,
        r.targetId,
        r.metadata,
      ]
        .map(escape)
        .join(',')
    ),
  ]
  return lines.join('\n')
}

function ActorCell({ row }: { row: AuditEventRow }) {
  if (!row.actorEmail) return <span className="text-muted-foreground">—</span>
  return (
    <>
      {row.actorEmail}
      {row.actorRole ? (
        <span className="ml-1.5 text-muted-foreground">({row.actorRole})</span>
      ) : null}
    </>
  )
}

function TargetCell({ row }: { row: AuditEventRow }) {
  if (!row.targetType) return <span className="text-muted-foreground">—</span>
  return (
    <span>
      <span className="text-muted-foreground">{row.targetType}</span>
      {row.targetId ? <span className="ml-1 font-mono">{row.targetId}</span> : null}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: AuditEventRow['eventOutcome'] }) {
  return (
    <Badge variant={outcome === 'success' ? 'secondary' : 'destructive'} className="text-xs">
      {outcome}
    </Badge>
  )
}

function downloadCsv(rows: AuditEventRow[]): void {
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function AuditLogPage() {
  const [eventType, setEventType] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')

  const filters = useMemo(
    () => ({
      eventType: eventType === 'all' ? undefined : eventType,
      from: rangeToFromIso(timeRange),
      limit: 200,
    }),
    [eventType, timeRange]
  )

  const { data } = useSuspenseQuery(adminQueries.auditEvents(filters))
  const rows = data.events

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue placeholder="Event type" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_EVENT_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(rows)}
          disabled={rows.length === 0}
        >
          <ArrowDownTrayIcon className="size-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-24">Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                  No audit events match these filters yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(row.occurredAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                  <TableCell className="text-xs">
                    <ActorCell row={row} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <TargetCell row={row} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={row.eventOutcome} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the most recent {rows.length} events. Narrow the filters to see older entries.
        </p>
      ) : null}
    </div>
  )
}
