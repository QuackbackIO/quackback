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
 *
 * A sign-out and a handoff can run at once (two tabs). Each writes first and
 * reads after: sign-out ends the session and its root, then reads the family;
 * a handoff records its new session, then checks the source and the root are
 * still live. Whichever order they meet in, the new session is ended or never
 * installed. So a sign-in whose root has ended carries no further: its other
 * hosts stay signed in until they sign out, and a new host signs in afresh.
 *
 * The rows end with their session and move with it as it slides
 * (`followSessionExpiry`).
 */
import type { UserId } from '@quackback/ids'
import { and, db, eq, gt, inArray, or, session, verification } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'section-sign-out' })

/** Every link row's identifier starts with this. */
export const SESSION_LINK_PREFIX = 'section-session-'
const ROOT_PREFIX = `${SESSION_LINK_PREFIX}root:`
const FAMILY_PREFIX = `${SESSION_LINK_PREFIX}family:`

function errorName(err: unknown): { error_name: string } {
  return { error_name: err instanceof Error ? err.name : typeof err }
}

async function rootOf(sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, `${ROOT_PREFIX}${sessionId}`))
    .limit(1)
  return row?.value ?? null
}

/** Forget a carried session's rows. */
async function dropLinks(carriedId: string, root: string): Promise<void> {
  await db
    .delete(verification)
    .where(
      or(
        eq(verification.identifier, `${ROOT_PREFIX}${carriedId}`),
        and(
          eq(verification.identifier, `${FAMILY_PREFIX}${root}`),
          eq(verification.value, carriedId)
        )
      )
    )
}

/**
 * Record that `carriedId` was signed in from `sourceId` by a handoff, then
 * check the sign-in is still live: the source and its root. A sign-out
 * ends the session and its root before it reads the family, so a carried
 * session recorded after that read finds its root gone here and is refused.
 * One recorded before that read is in the family the sign-out ends.
 *
 * Returns false when the sign-in has ended (the rows are dropped again); the
 * caller must then not install the session. Throws when the rows are not
 * written: a carried session that sign-out could not find must not be
 * installed either. The rows end when the session does (`followSessionExpiry`
 * keeps them in step as it slides).
 */
export async function recordHandoffSession(
  carriedId: string,
  sourceId: string,
  userId: string,
  expiresAt: Date
): Promise<boolean> {
  const root = (await rootOf(sourceId)) ?? sourceId
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
  const needed = [...new Set([sourceId, root])]
  const live = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        inArray(session.id, needed),
        eq(session.userId, userId as UserId),
        gt(session.expiresAt, new Date())
      )
    )
  if (live.length === needed.length) return true
  await dropLinks(carriedId, root)
  return false
}

/**
 * A session's expiry moved (the library slides it while the session is used):
 * move its rows with it, so they last exactly as long as the session. Wired
 * as the session update hook. Best effort.
 */
export async function followSessionExpiry(updated: unknown): Promise<void> {
  const s = updated as { id?: unknown; expiresAt?: unknown } | null
  if (!s || typeof s.id !== 'string' || !(s.expiresAt instanceof Date)) return
  try {
    const [row] = await db
      .update(verification)
      .set({ expiresAt: s.expiresAt })
      .where(eq(verification.identifier, `${ROOT_PREFIX}${s.id}`))
      .returning({ root: verification.value })
    if (!row) return
    await db
      .update(verification)
      .set({ expiresAt: s.expiresAt })
      .where(
        and(
          eq(verification.identifier, `${FAMILY_PREFIX}${row.root}`),
          eq(verification.value, s.id)
        )
      )
  } catch (err) {
    log.warn(errorName(err), 'section session links not moved with the session expiry')
  }
}

/**
 * End `current` and every session of the same sign-in on other hosts, for
 * `current.userId` only. Returns how many sessions were ended.
 *
 * The session and its root are ended FIRST, then the families are read and
 * their members ended. A handoff finishing meanwhile records its session and
 * then re-checks the root (`recordHandoffSession`): either the family read
 * here sees it, or it sees the root gone and refuses. A fixed number of
 * reads, so rows that loop or point at each other cannot make it run longer.
 *
 * `seams.afterFamilyRead` runs between the family read and the members'
 * end, for tests that force a handoff into that window.
 */
export async function revokeHandoffFamily(
  current: { id: string; userId: string },
  seams: { afterFamilyRead?: () => Promise<void> } = {}
): Promise<number> {
  const owned = eq(session.userId, current.userId as UserId)
  const root = (await rootOf(current.id)) ?? current.id
  const heads = [...new Set([current.id, root])]
  const endedHeads = await db
    .delete(session)
    .where(and(inArray(session.id, heads), owned))
    .returning({ id: session.id })

  const members = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      inArray(
        verification.identifier,
        heads.map((id) => `${FAMILY_PREFIX}${id}`)
      )
    )
  await seams.afterFamilyRead?.()
  const memberIds = [...new Set(members.map((m) => m.value))].filter((id) => !heads.includes(id))
  const endedMembers =
    memberIds.length === 0
      ? []
      : await db
          .delete(session)
          .where(and(inArray(session.id, memberIds), owned))
          .returning({ id: session.id })

  // Clear the rows of the sessions that ended, and of this one: a row that
  // names someone else's session is left for its own sign-out.
  const cleared = [
    ...new Set([current.id, ...endedHeads.map((e) => e.id), ...endedMembers.map((e) => e.id)]),
  ]
  await db.delete(verification).where(
    or(
      inArray(
        verification.identifier,
        cleared.flatMap((id) => [`${ROOT_PREFIX}${id}`, `${FAMILY_PREFIX}${id}`])
      ),
      and(
        inArray(
          verification.identifier,
          heads.map((id) => `${FAMILY_PREFIX}${id}`)
        ),
        inArray(verification.value, cleared)
      )
    )
  )
  return endedHeads.length + endedMembers.length
}

/**
 * Clear the rows of a sign-in's carried sessions that ended some other way
 * (expired, or revoked on their own). Run after a handoff is installed, for
 * that handoff's family only, by exact identifiers. Best effort.
 */
export async function sweepEndedLinks(sourceId: string): Promise<void> {
  try {
    const root = (await rootOf(sourceId)) ?? sourceId
    const familyId = `${FAMILY_PREFIX}${root}`
    const members = await db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, familyId))
    const ids = [...new Set(members.map((m) => m.value))]
    if (ids.length === 0) return
    const live = await db.select({ id: session.id }).from(session).where(inArray(session.id, ids))
    const liveIds = new Set(live.map((l) => l.id))
    const ended = ids.filter((id) => !liveIds.has(id))
    if (ended.length === 0) return
    await db.delete(verification).where(
      or(
        inArray(
          verification.identifier,
          ended.map((id) => `${ROOT_PREFIX}${id}`)
        ),
        and(eq(verification.identifier, familyId), inArray(verification.value, ended))
      )
    )
  } catch (err) {
    log.warn(errorName(err), 'ended section session links not cleared')
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
    log.error(errorName(err), 'sign-out on other hosts failed; this host is still signed out')
  }
}
