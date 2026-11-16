/**
 * Signing out across section hosts. Sessions are host-only cookies, and the
 * section handoff (section-handoff.ts) signs a visitor in on another host
 * with a NEW session. One sign-in can so hold a session on every host of the
 * workspace. Signing out on any of them ends them all.
 *
 * Each carried session records the sign-in it came from, its root: the source
 * session's own root when the source was itself carried, else the source.
 * Every member of a family so names the same root, however long the chain of
 * handoffs, and finding the family takes two indexed reads, no walk:
 *
 *   section-session-root:<carried id>   -> root id
 *   section-session-family:<root id>    -> carried id   (one row per member)
 *
 * The rows live in the verification table and hold session ids only, never a
 * token. On sign-out the session, its root and both families are ended, and
 * only sessions of the person signing out: a row naming someone else's session
 * ends nothing. On Cloud each workspace has its own database, so a family
 * never reaches another workspace.
 *
 * Revoking on the server is enough for the other hosts: their cookies now
 * name ended sessions, so their next request reads signed out.
 */
import type { UserId } from '@quackback/ids'
import { and, db, eq, inArray, like, or, session, sql, verification } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'section-sign-out' })

const ROOT_PREFIX = 'section-session-root:'
const FAMILY_PREFIX = 'section-session-family:'

/**
 * How long a link row is kept. A carried session slides its expiry while it is
 * used, so the rows are not tied to it; rows whose session has ended are
 * cleared by `sweepEndedLinks` instead. This only bounds a row that sweep
 * somehow never reaches.
 */
const LINK_TTL_MS = 400 * 24 * 60 * 60 * 1000

async function rootOf(sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, `${ROOT_PREFIX}${sessionId}`))
    .limit(1)
  return row?.value ?? null
}

/**
 * Record that `carriedId` was signed in from `sourceId` by a handoff. Throws
 * when the rows are not written: a carried session that sign-out could not
 * find must not be installed.
 */
export async function recordHandoffSession(carriedId: string, sourceId: string): Promise<void> {
  const root = (await rootOf(sourceId)) ?? sourceId
  const expiresAt = new Date(Date.now() + LINK_TTL_MS)
  await db.insert(verification).values([
    {
      id: crypto.randomUUID(),
      identifier: `${ROOT_PREFIX}${carriedId}`,
      value: root,
      expiresAt,
    },
    {
      id: crypto.randomUUID(),
      identifier: `${FAMILY_PREFIX}${root}`,
      value: carriedId,
      expiresAt,
    },
  ])
}

/**
 * End `current` and every session of the same sign-in on other hosts, for
 * `current.userId` only. Returns how many sessions were ended. A fixed number
 * of reads: the session's root, then the families of the session and its root.
 * Rows that loop or point at each other cannot make it run longer.
 */
export async function revokeHandoffFamily(current: {
  id: string
  userId: string
}): Promise<number> {
  const root = (await rootOf(current.id)) ?? current.id
  const heads = [...new Set([current.id, root])]
  const members = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      inArray(
        verification.identifier,
        heads.map((id) => `${FAMILY_PREFIX}${id}`)
      )
    )
  const ids = [...new Set([...heads, ...members.map((m) => m.value)])]

  const ended = await db
    .delete(session)
    .where(and(inArray(session.id, ids), eq(session.userId, current.userId as UserId)))
    .returning({ id: session.id })

  // Clear the rows of the sessions that ended, and of this one: a row that
  // names someone else's session is left for its own sign-out.
  const cleared = [...new Set([current.id, ...ended.map((e) => e.id)])]
  await db.delete(verification).where(
    or(
      inArray(
        verification.identifier,
        cleared.flatMap((id) => [`${ROOT_PREFIX}${id}`, `${FAMILY_PREFIX}${id}`])
      ),
      and(like(verification.identifier, `${FAMILY_PREFIX}%`), inArray(verification.value, cleared))
    )
  )
  return ended.length
}

/**
 * Clear link rows whose session has ended (expired, signed out alone, or
 * revoked some other way). Best effort, run on each handoff finish, so the
 * rows never pile up.
 */
export async function sweepEndedLinks(): Promise<void> {
  try {
    await db
      .delete(verification)
      .where(
        or(
          and(
            like(verification.identifier, `${ROOT_PREFIX}%`),
            sql`not exists (select 1 from ${session} where ${session.id} = substr(${verification.identifier}, ${ROOT_PREFIX.length + 1}))`
          ),
          and(
            like(verification.identifier, `${FAMILY_PREFIX}%`),
            sql`not exists (select 1 from ${session} where ${session.id} = ${verification.value})`
          )
        )
      )
  } catch (err) {
    log.warn(
      { error_name: err instanceof Error ? err.name : typeof err },
      'ended section session links not cleared'
    )
  }
}

interface SignOutCtx {
  path?: string
  getSignedCookie?: (name: string, secret: string) => Promise<string | null | false>
  context?: {
    secret?: string
    authCookies?: { sessionToken?: { name?: string } }
  }
}

/**
 * The `/sign-out` before-hook. Reads the session the way the library's own
 * sign-out does (the signed session cookie), then ends its family; the
 * library then ends the session itself and clears this host's cookie. Never
 * blocks the sign-out: a failure here is logged and the sign-out goes on.
 */
export async function signOutHandoffFamily(ctx: SignOutCtx): Promise<void> {
  if (ctx.path !== '/sign-out') return
  const name = ctx.context?.authCookies?.sessionToken?.name
  const secret = ctx.context?.secret
  if (!name || !secret || !ctx.getSignedCookie) return
  try {
    const token = await ctx.getSignedCookie(name, secret)
    if (!token) return
    const [current] = await db
      .select({ id: session.id, userId: session.userId })
      .from(session)
      .where(eq(session.token, token))
      .limit(1)
    if (!current) return
    const ended = await revokeHandoffFamily(current)
    if (ended > 1) log.info({ sessions_ended: ended }, 'signed out on every host')
  } catch (err) {
    log.error(
      { error_name: err instanceof Error ? err.name : typeof err },
      'sign-out on other hosts failed; this host is still signed out'
    )
  }
}
