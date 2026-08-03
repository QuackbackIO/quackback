/**
 * Audit log queries — cursor-paged unified event feed + distinct-actions list.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'
import { listUnifiedAuditEventsFn, getUnifiedAuditActionsFn } from '@/lib/server/functions/audit'

export type AuditSourceFilter = 'web' | 'api' | 'integration' | 'system' | 'mcp'
export type AuditOriginFilter = 'workspace' | 'security'
export type AuditTimeRange = '7d' | '30d' | '90d' | 'all' | 'custom'

export interface AuditFilters {
  origin?: AuditOriginFilter
  principalId?: PrincipalId | null
  actorEmail?: string
  /** Exact match on action/event type. Mutually exclusive with `actionPrefix`. */
  action?: string
  /** Prefix match (`like 'foo%'`) on action/event type. */
  actionPrefix?: string
  targetType?: string
  targetId?: string
  source?: AuditSourceFilter
  /** ISO datetime — inclusive lower bound. */
  fromIso?: string
  /** ISO datetime — inclusive upper bound. */
  toIso?: string
}

export const DEFAULT_AUDIT_TIME_RANGE: AuditTimeRange = '30d'
export const DEFAULT_EXCLUDED_SECURITY_ACTIONS = ['portal.widget_handshake.consumed'] as const

const STALE = 15_000
const ACTIONS_STALE = 5 * 60_000

export function rangeToFromIso(range: AuditTimeRange): string | undefined {
  if (range === 'all' || range === 'custom') return undefined
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const minuteMs = 60 * 1000
  const now = Math.floor(Date.now() / minuteMs) * minuteMs
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString()
}

export function defaultAuditFilters(): AuditFilters {
  return {
    fromIso: rangeToFromIso(DEFAULT_AUDIT_TIME_RANGE),
  }
}

export const auditQueries = {
  all: ['audit'] as const,
  list: (filters: AuditFilters = {}) =>
    infiniteQueryOptions({
      queryKey: ['audit', 'list', filters] as const,
      queryFn: ({ pageParam }) =>
        listUnifiedAuditEventsFn({
          data: {
            origin: filters.origin,
            principalId: filters.principalId ?? undefined,
            actorEmail: filters.actorEmail,
            action: filters.action,
            actionPrefix: filters.actionPrefix,
            targetType: filters.targetType,
            targetId: filters.targetId,
            source: filters.source,
            from: filters.fromIso,
            to: filters.toIso,
            cursor: (pageParam as string | undefined) ?? undefined,
            limit: 50,
            excludeSecurityActions:
              filters.action || filters.actionPrefix
                ? undefined
                : [...DEFAULT_EXCLUDED_SECURITY_ACTIONS],
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => (last as { nextCursor?: string | null }).nextCursor ?? undefined,
      staleTime: STALE,
    }),
  actions: () =>
    queryOptions({
      queryKey: ['audit', 'actions'] as const,
      queryFn: () => getUnifiedAuditActionsFn(),
      staleTime: ACTIONS_STALE,
    }),
}
