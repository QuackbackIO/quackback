/**
 * The REST API's boundary audit: one `api.write` row for every write an API
 * key makes under /api/v1, whatever the route does on its own.
 *
 * The row names the method, the route pattern (ids replaced by `:id`), the
 * resource the path points at or the one a create returned, and the status
 * with the error code of a refusal. It never holds the request body, the query
 * string or a credential. It costs one insert and no read: the route already
 * authenticated the key and stated it as the request's attribution
 * (domains/api/auth.ts), and the response is already in hand.
 *
 * A request no key authenticated is not recorded: it changed nothing, and
 * anyone can send one. An import (an admin key with `x-import-mode`) is
 * summarised as `api.import`, one row per key per minute with a count.
 */
import { isUuid, isValidTypeId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { getAuditAttribution, getAuditBoundaryActor, isAuditImportMode } from './attribution'
import { recordAuditEvent, recordAuditRollup, type AuditTarget } from './log'
import { typeIdTarget } from './targets'

const log = logger.child({ component: 'audit' })

const API_PREFIX = '/api/v1/'
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ERROR_CODE_MAX_LEN = 100

/** A write to the REST API: anything but a read under /api/v1. */
export function isApiWrite(request: Request): boolean {
  if (READ_METHODS.has(request.method.toUpperCase())) return false
  return new URL(request.url).pathname.startsWith(API_PREFIX)
}

function isIdSegment(segment: string): boolean {
  return segment !== '' && (isValidTypeId(segment) || isUuid(segment))
}

/**
 * Every word the REST routes use in their paths. A test keeps this in step
 * with the route files, so a real route always keeps its own name.
 */
export const API_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  'accept',
  'activity',
  'admin',
  'agent',
  'api',
  'approvals',
  'approve',
  'apps',
  'articles',
  'assign',
  'boards',
  'card',
  'categories',
  'changelog',
  'columns',
  'comments',
  'companies',
  'components',
  'conversations',
  'dismiss',
  'docs',
  'feedback',
  'files',
  'help-center',
  'handoff',
  'identify',
  'incidents',
  'json',
  'link',
  'linked',
  'members',
  'mentions',
  'merge',
  'messages',
  'moderation',
  'note',
  'openapi',
  'pending',
  'posts',
  'principals',
  'priority',
  'proxy',
  'read',
  'receipts',
  'reject',
  'reply',
  'resolve',
  'restore',
  'roadmaps',
  'rotate',
  'search',
  'segments',
  'services',
  'settings',
  'setup',
  'status',
  'stream',
  'statuses',
  'suggest',
  'suggestions',
  'summary',
  'tags',
  'ticket-statuses',
  'tickets',
  'turns',
  'undo',
  'unlink',
  'updates',
  'usage',
  'users',
  'v1',
  'vote',
  'voters',
  'webhooks',
])

/** The longest route pattern a row keeps. */
export const API_ROUTE_MAX_LEN = 300

/**
 * The path as a route: its own words kept, each id replaced by `:id`, and
 * anything else (a slug, or a segment the caller made up) by `:param`, so one
 * route reads as one route and a row never carries what a caller typed.
 * Capped at {@link API_ROUTE_MAX_LEN}.
 */
export function apiRoutePattern(pathname: string): string {
  const pattern = pathname
    .split('/')
    .map((segment) => {
      if (segment === '' || API_ROUTE_SEGMENTS.has(segment)) return segment
      return isIdSegment(segment) ? ':id' : ':param'
    })
    .join('/')
  return pattern.length > API_ROUTE_MAX_LEN ? pattern.slice(0, API_ROUTE_MAX_LEN) : pattern
}

/** The most specific resource a path names: its last TypeID segment. */
export function apiPathTarget(pathname: string): AuditTarget | null {
  const segments = pathname.split('/')
  for (let i = segments.length - 1; i >= 0; i--) {
    const target = typeIdTarget(segments[i])
    if (target) return target
  }
  return null
}

/** A JSON response body, read from a clone so the client still gets it. */
async function jsonBody(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  try {
    const body: unknown = await response.clone().json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

/**
 * Record the write, given the response the route produced, or null when the
 * handler threw (reported as a 500). Never throws: a failure is logged and
 * the response goes out regardless.
 */
export async function recordApiWrite(request: Request, response: Response | null): Promise<void> {
  try {
    const attribution = getAuditAttribution()
    if (attribution?.channel !== 'api') return

    const status = response?.status ?? 500
    const failed = status >= 400
    const actor = getAuditBoundaryActor() ?? { authMethod: 'api_key' as const }

    // A bulk import is one row per key per minute with a count, not a row per
    // write: a large import would otherwise bury every other event for a year.
    if (isAuditImportMode()) {
      const window = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
      await recordAuditRollup(
        {
          event: 'api.import',
          outcome: failed ? 'failure' : 'success',
          actor,
          headers: request.headers,
          metadata: { window },
        },
        `api.import:${attribution.credentialId ?? ''}:${window}`
      )
      return
    }

    const pathname = new URL(request.url).pathname

    let target = apiPathTarget(pathname)
    let errorCode: string | null = null
    if (response && (status === 201 || failed)) {
      const body = await jsonBody(response)
      if (status === 201) target ??= typeIdTarget(field(field(body, 'data'), 'id'))
      const code = field(field(body, 'error'), 'code')
      if (failed && typeof code === 'string') errorCode = code.slice(0, ERROR_CODE_MAX_LEN)
    }

    await recordAuditEvent({
      event: 'api.write',
      outcome: failed ? 'failure' : 'success',
      actor,
      headers: request.headers,
      target: target ?? undefined,
      metadata: {
        method: request.method.toUpperCase(),
        route: apiRoutePattern(pathname),
        status,
        ...(errorCode ? { errorCode } : {}),
      },
    })
  } catch (error) {
    log.error({ err: error }, 'api write audit failed')
  }
}
