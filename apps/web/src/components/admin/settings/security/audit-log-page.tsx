/**
 * Admin audit-log feed. Renders a paginated table of recent security-
 * sensitive actions with filters (event type, outcome, time range)
 * and a CSV export of the currently-filtered window.
 */
import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
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
import { Input } from '@/components/ui/input'
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

/**
 * Two-line timestamp: "May 13" above "12:48 AM". Keeps the When
 * column narrow without forcing the date string to wrap mid-word
 * when the table is squeezed by long target IDs. Year is omitted —
 * audit-log retention caps at 365 days by default so every row is
 * within the current year.
 */
function formatTimestamp(iso: string): { date: string; time: string; full: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    full: d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  }
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
    <div className="flex flex-col">
      <span className="truncate">{row.actorEmail}</span>
      {row.actorRole ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {row.actorRole}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Target cell: the type sits on the top line as a label and the ID
 * goes on a second line in monospace, truncated with a tooltip for
 * the full value. Stacking is what stops the long
 * `domain_01krf77nfbf23v3dmx5ztdjkzr` string from blowing out the
 * row width.
 */
function TargetCell({ row }: { row: AuditEventRow }) {
  if (!row.targetType) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {row.targetType}
      </span>
      {row.targetId ? (
        <span className="truncate font-mono text-[11px]" title={row.targetId}>
          {row.targetId}
        </span>
      ) : null}
    </div>
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
  const [actorEmailInput, setActorEmailInput] = useState<string>('')
  // Debounce so each keystroke doesn't fire a fresh server-fn request.
  // 300ms feels instant without spamming.
  const debouncedActorEmail = useDebouncedValue(actorEmailInput, 300)

  const filters = useMemo(
    () => ({
      eventType: eventType === 'all' ? undefined : eventType,
      actorEmail: debouncedActorEmail.trim() || undefined,
      from: rangeToFromIso(timeRange),
      limit: 200,
    }),
    [eventType, timeRange, debouncedActorEmail]
  )

  const { data } = useSuspenseQuery(adminQueries.auditEvents(filters))
  const rows = data.events

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-9 w-full sm:w-64 text-xs">
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
            <SelectTrigger className="h-9 w-full sm:w-36 text-xs">
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
          <Input
            type="search"
            placeholder="Filter by actor email"
            value={actorEmailInput}
            onChange={(e) => setActorEmailInput(e.target.value)}
            className="h-9 w-full sm:w-56 text-xs"
            aria-label="Filter audit events by actor email"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(rows)}
          disabled={rows.length === 0}
          className="h-9"
        >
          <ArrowDownTrayIcon className="size-3.5" />
          Export CSV
        </Button>
      </div>

      {/* md+: horizontal-scrolling fixed-width table. `overflow-x-auto`
       *  lets the table scroll rather than wrapping cells into
       *  single-word columns. `table-fixed` + explicit widths give the
       *  browser stable layout targets. */}
      <div className="hidden md:block overflow-x-auto rounded-md border">
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[7rem]">When</TableHead>
              <TableHead className="w-[18rem]">Event</TableHead>
              <TableHead className="w-[16rem]">Actor</TableHead>
              <TableHead className="w-[18rem]">Target</TableHead>
              <TableHead className="w-[5rem]">Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No audit events match these filters yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const stamp = formatTimestamp(row.occurredAt)
                return (
                  <TableRow key={row.id}>
                    <TableCell
                      className="whitespace-nowrap text-muted-foreground"
                      title={stamp.full}
                    >
                      <div className="flex flex-col leading-tight">
                        <span>{stamp.date}</span>
                        <span className="text-[10px]">{stamp.time}</span>
                      </div>
                    </TableCell>
                    <TableCell className="truncate font-mono" title={row.eventType}>
                      {row.eventType}
                    </TableCell>
                    <TableCell className="truncate">
                      <ActorCell row={row} />
                    </TableCell>
                    <TableCell>
                      <TargetCell row={row} />
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={row.eventOutcome} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* below md: stacked event cards */}
      <div className="md:hidden rounded-md border divide-y divide-border">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No audit events match these filters yet.
          </p>
        ) : (
          rows.map((row) => {
            const stamp = formatTimestamp(row.occurredAt)
            return (
              <div key={row.id} className="p-3 space-y-2">
                {/* Primary: event type + outcome */}
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="font-mono text-xs truncate text-foreground"
                    title={row.eventType}
                  >
                    {row.eventType}
                  </span>
                  <OutcomeBadge outcome={row.eventOutcome} />
                </div>
                {/* Secondary fields */}
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <span className="w-12 shrink-0 font-medium text-foreground/60">When</span>
                    <span title={stamp.full}>
                      {stamp.date} {stamp.time}
                    </span>
                  </div>
                  {row.actorEmail && (
                    <div className="flex gap-2">
                      <span className="w-12 shrink-0 font-medium text-foreground/60">Actor</span>
                      <span className="truncate">{row.actorEmail}</span>
                    </div>
                  )}
                  {row.targetType && (
                    <div className="flex gap-2">
                      <span className="w-12 shrink-0 font-medium text-foreground/60">Target</span>
                      <div className="min-w-0">
                        <span className="uppercase tracking-wide text-[10px]">
                          {row.targetType}
                        </span>
                        {row.targetId && (
                          <p className="font-mono text-[11px] truncate" title={row.targetId}>
                            {row.targetId}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {data.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the most recent {rows.length} events. Narrow the filters to see older entries.
        </p>
      ) : null}
    </div>
  )
}
