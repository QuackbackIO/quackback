/**
 * GET /api/v1/mentions/suggest
 * @-mention typeahead. Session-authenticated (anonymous + service principals
 * are rejected). Matches `lower(displayName)` with a prefix LIKE — never
 * queries email — and uses the functional index from migration 0065.
 *
 * An empty `q` returns the first page of eligible users in the workspace so
 * the picker has something to show the moment the user types `@`.
 *
 * Rate-limited per session: 60 requests / 60s on a single Redis bucket.
 * Fails open on Redis errors (the limiter returns `null` count then).
 */
import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import type { SQL } from 'drizzle-orm'
import { auth } from '@/lib/server/auth'
import { db, principal, eq, and, inArray, sql } from '@/lib/server/db'
import type { Role } from '@/lib/shared/roles'
import { incrementBucket } from '@/lib/server/utils/redis-rate-bucket'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

const MENTION_ELIGIBLE_ROLES = ['admin', 'member', 'user'] as const
const SUGGEST_LIMIT = 10
const RATE_LIMIT = 60
const RATE_WINDOW_SECONDS = 60

interface SuggestRow {
  principalId: string
  displayName: string | null
  avatarUrl: string | null
  role: Role
}

function resolveAvatar(avatarKey: string | null, avatarUrl: string | null): string | null {
  if (avatarKey) {
    const s3Url = getPublicUrlOrNull(avatarKey)
    if (s3Url) return s3Url
  }
  return avatarUrl ?? null
}

export async function handleMentionSuggest({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Caller must be a real human user — anonymous (portal voters) and service
  // (API key) principals never get to enumerate the user directory.
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { id: true, type: true },
  })
  if (!principalRecord || principalRecord.type !== 'user') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 60 req / minute per session principal. Single-bucket; fails open on
  // Redis error (count === null). We block when count > limit so the 60th
  // request still goes through and the 61st returns 429.
  const bucket = await incrementBucket({
    key: `mention-suggest:${principalRecord.id}`,
    windowSeconds: RATE_WINDOW_SECONDS,
  })
  if (bucket.count !== null && bucket.count > RATE_LIMIT) {
    return Response.json({ error: 'Too Many Requests' }, { status: 429 })
  }

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()

  // Non-empty `q` uses a prefix LIKE against the lower(display_name)
  // functional index (migration 0065). No substring search — that would
  // escalate typeahead to a directory dump via wildcard probing. Empty `q`
  // returns the first page of eligible users. Email is never selected.
  const predicates: SQL[] = [
    eq(principal.type, 'user'),
    inArray(principal.role, [...MENTION_ELIGIBLE_ROLES]),
  ]
  if (q.length > 0) {
    predicates.push(sql`lower(${principal.displayName}) LIKE ${`${q}%`}`)
  }
  const rows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      avatarKey: principal.avatarKey,
      role: principal.role,
    })
    .from(principal)
    .where(and(...predicates))
    .orderBy(sql`lower(${principal.displayName})`)
    .limit(SUGGEST_LIMIT)

  const result: SuggestRow[] = rows.map((r) => ({
    principalId: r.id,
    displayName: r.displayName,
    avatarUrl: resolveAvatar(r.avatarKey, r.avatarUrl),
    role: r.role as Role,
  }))

  return Response.json(result, { status: 200 })
}

export const Route = createFileRoute('/api/v1/mentions/suggest')({
  server: {
    handlers: {
      GET: handleMentionSuggest,
    },
  },
})
