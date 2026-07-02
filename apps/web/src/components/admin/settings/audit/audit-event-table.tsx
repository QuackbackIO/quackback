/**
 * Unified audit event table — cursor-paged via `useSuspenseInfiniteQuery`.
 * Workspace actors are resolved in a single batched lookup; security rows use
 * denormalized actor fields so deleted users still render coherently.
 */
import { Fragment, useMemo, useState } from 'react'
import { useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'
import { auditQueries, type AuditFilters } from '@/lib/client/queries/audit'
import { getPrincipalsByIdsFn } from '@/lib/server/functions/principals'
import type { UnifiedAuditEventRow } from '@/lib/server/domains/audit/audit.unified'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowDownTrayIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { AuditDiffViewer } from './audit-diff-viewer'
import { downloadAuditCsv } from './audit-csv'

interface Props {
  filters: AuditFilters
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function formatTimestamp(value: Date | string): { date: string; time: string; full: string } {
  const d = toDate(value)
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

function OriginBadge({ origin }: { origin: UnifiedAuditEventRow['origin'] }) {
  return (
    <Badge variant={origin === 'security' ? 'secondary' : 'outline'} className="text-[10px]">
      {origin}
    </Badge>
  )
}

function OutcomeBadge({ outcome }: { outcome: UnifiedAuditEventRow['outcome'] }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Badge variant={outcome === 'success' ? 'secondary' : 'destructive'} className="text-xs">
      {outcome}
    </Badge>
  )
}

function TargetCell({ row }: { row: UnifiedAuditEventRow }) {
  if (!row.targetType) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col text-xs">
      <span className="font-mono text-muted-foreground">{row.targetType}</span>
      {row.targetId ? (
        <span className="truncate font-mono text-[11px]" title={row.targetId}>
          {row.targetId}
        </span>
      ) : null}
    </div>
  )
}

export function AuditEventTable({ filters }: Props) {
  const query = useSuspenseInfiniteQuery(auditQueries.list(filters))
  const items = useMemo(() => query.data.pages.flatMap((p) => p.items), [query.data])

  const principalIds = useMemo(() => {
    const set = new Set<string>()
    for (const row of items) {
      if (row.origin === 'workspace' && row.principalId) set.add(row.principalId)
    }
    return Array.from(set)
  }, [items])

  const principalsQuery = useQuery({
    queryKey: ['principals', 'byIds', principalIds] as const,
    queryFn: () => getPrincipalsByIdsFn({ data: { ids: principalIds as PrincipalId[] } }),
    enabled: principalIds.length > 0,
    staleTime: 60_000,
  })

  const principalMap = useMemo(() => {
    const m = new Map<string, { displayName: string | null; email: string | null; role: string }>()
    for (const principal of principalsQuery.data ?? []) {
      m.set(principal.id, {
        displayName: principal.displayName,
        email: principal.email,
        role: principal.role,
      })
    }
    return m
  }, [principalsQuery.data])

  const rowKey = (row: Pick<UnifiedAuditEventRow, 'origin' | 'id'>) => `${row.origin}:${row.id}`

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const actorLabel = (row: UnifiedAuditEventRow) => {
    const resolved = row.principalId ? principalMap.get(row.principalId) : null
    return (
      resolved?.displayName ??
      resolved?.email ??
      row.actorDisplayName ??
      row.actorEmail ??
      row.principalId ??
      row.actorUserId ??
      (row.actorType ? `(${row.actorType})` : null)
    )
  }

  const actorSubtitle = (row: UnifiedAuditEventRow) => {
    const resolved = row.principalId ? principalMap.get(row.principalId) : null
    return [resolved?.email, row.actorRole ?? resolved?.role, row.actorType, row.authMethod]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{items.length} events shown</span>
        <Button
          variant="outline"
          size="sm"
          disabled={items.length === 0}
          onClick={() => downloadAuditCsv(items)}
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="hidden md:block overflow-x-auto rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-28">When</TableHead>
              <TableHead className="w-24">Origin</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-24">Outcome</TableHead>
              <TableHead className="w-24">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                  No audit events match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => {
                const key = rowKey(row)
                const isOpen = expanded.has(key)
                const actor = actorLabel(row)
                const subtitle = actorSubtitle(row)
                const stamp = formatTimestamp(row.occurredAt)
                return (
                  <Fragment key={key}>
                    <TableRow className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          type="button"
                          aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                          onClick={() => toggle(key)}
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
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title={stamp.full}
                      >
                        <div className="flex flex-col leading-tight">
                          <span>{stamp.date}</span>
                          <span className="text-[10px]">{stamp.time}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OriginBadge origin={row.origin} />
                      </TableCell>
                      <TableCell>
                        {actor ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6 text-[10px]">
                              {actor.slice(0, 2).toUpperCase()}
                            </Avatar>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate text-sm">{actor}</span>
                              {subtitle ? (
                                <span className="truncate text-[11px] text-muted-foreground">
                                  {subtitle}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            System
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-[11px] bg-muted/40 px-1.5 py-0.5 rounded">
                          {row.action}
                        </code>
                      </TableCell>
                      <TableCell>
                        <TargetCell row={row} />
                      </TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={row.outcome} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {row.source ?? '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell />
                        <TableCell colSpan={7} className="py-3">
                          <AuditDiffViewer
                            diff={row.diff}
                            ipAddress={row.ipAddress}
                            userAgent={row.userAgent}
                          />
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

      <div className="md:hidden rounded-md border divide-y divide-border">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No audit events match the current filters.
          </p>
        ) : (
          items.map((row) => {
            const key = rowKey(row)
            const isOpen = expanded.has(key)
            const stamp = formatTimestamp(row.occurredAt)
            const actor = actorLabel(row)
            return (
              <div key={key} className="p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <OriginBadge origin={row.origin} />
                      <span className="text-xs text-muted-foreground" title={stamp.full}>
                        {stamp.date} {stamp.time}
                      </span>
                    </div>
                    <p className="truncate font-mono text-xs" title={row.action}>
                      {row.action}
                    </p>
                  </div>
                  <OutcomeBadge outcome={row.outcome} />
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {actor ? (
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 font-medium text-foreground/60">Actor</span>
                      <span className="truncate">{actor}</span>
                    </div>
                  ) : null}
                  {row.targetType ? (
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 font-medium text-foreground/60">Target</span>
                      <div className="min-w-0">
                        <span className="uppercase tracking-wide text-[10px]">
                          {row.targetType}
                        </span>
                        {row.targetId ? (
                          <p className="truncate font-mono text-[11px]" title={row.targetId}>
                            {row.targetId}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {row.source ? (
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 font-medium text-foreground/60">Source</span>
                      <span>{row.source}</span>
                    </div>
                  ) : null}
                </div>

                <Button variant="ghost" size="sm" onClick={() => toggle(key)} className="h-8 px-2">
                  {isOpen ? 'Hide details' : 'Show details'}
                </Button>
                {isOpen ? (
                  <AuditDiffViewer
                    diff={row.diff}
                    ipAddress={row.ipAddress}
                    userAgent={row.userAgent}
                  />
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {query.hasNextPage ? 'More events are available.' : 'End of matching events.'}
        </span>
        {query.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
