/**
 * Preview links: the portal drawn with a design not yet live, for someone
 * without admin access. A link holds the design being edited as it was when
 * the link was made, so later edits never reach it, and only the SHA-256 hash
 * of its token. The token is shown once, in the link; an expired or revoked
 * link draws the live portal.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { PortalDesignPreviewId } from '@quackback/ids'
import {
  and,
  count,
  db,
  desc,
  eq,
  gt,
  isNull,
  lt,
  or,
  portalDesignPreviewLinks as links,
  portalDesigns,
  principal,
  user,
} from '@/lib/server/db'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { config } from '@/lib/server/config'
import {
  isPreviewToken,
  PREVIEW_LINK_DAYS,
  PREVIEW_LINK_PARAM,
} from '@/lib/shared/design/preview-link'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalDesignView } from '@/lib/shared/design/view'
import { readDraftForChange } from './design.actions'
import { designRow, storedDesign, type DesignAuthor } from './design.service'
import { portalDesignView } from './engine'

/** How many live links a portal may have at once. */
export const PREVIEW_LINKS_MAX = 20
/** Links that ended this long ago are cleared when the next is made. */
const ENDED_KEPT_MS = 30 * 24 * 60 * 60 * 1000

export interface PreviewLink {
  id: PortalDesignPreviewId
  createdAt: string
  expiresAt: string
  /** Who made it, or null once they have left. */
  createdBy: string | null
}

export type PreviewLinkRefusal = {
  ok: false
  code: 'PREVIEW_LINK_LIMIT' | 'PREVIEW_LINK_NOT_FOUND'
  message: string
}

export type SharedPreview = { state: 'shown'; design: PortalDesign } | { state: 'ended' }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const live = (now: Date) => and(isNull(links.revokedAt), gt(links.expiresAt, now))

/** Makes a link to the design being edited, as it is now. */
export async function createPreviewLink(
  author: DesignAuthor
): Promise<{ ok: true; url: string; link: PreviewLink } | PreviewLinkRefusal> {
  const { design } = await readDraftForChange()
  const token = `qbp_${randomBytes(32).toString('base64url')}`
  return db.transaction(async (tx) => {
    await tx.insert(portalDesigns).values({}).onConflictDoNothing()
    // Locked, so two links made at once cannot pass the limit together.
    const row = (await designRow(tx, true))!
    const now = new Date()
    const [{ active }] = await tx
      .select({ active: count() })
      .from(links)
      .where(and(eq(links.designId, row.id), live(now)))
    if (active >= PREVIEW_LINKS_MAX) {
      return {
        ok: false as const,
        code: 'PREVIEW_LINK_LIMIT' as const,
        message: `A portal can have ${PREVIEW_LINKS_MAX} preview links at once. Revoke one to share another.`,
      }
    }
    const longAgo = new Date(now.getTime() - ENDED_KEPT_MS)
    await tx
      .delete(links)
      .where(
        and(
          eq(links.designId, row.id),
          or(lt(links.expiresAt, longAgo), lt(links.revokedAt, longAgo))
        )
      )
    const expiresAt = new Date(now.getTime() + PREVIEW_LINK_DAYS * 24 * 60 * 60 * 1000)
    const [created] = await tx
      .insert(links)
      .values({
        designId: row.id,
        tokenHash: hashToken(token),
        document: design,
        createdByPrincipalId: author.principalId,
        expiresAt,
        createdAt: now,
      })
      .returning({ id: links.id })
    await recordAuditEventInTransaction(tx, {
      event: 'design.preview_link.created',
      actor: author.actor,
      headers: author.headers,
      target: { type: 'portal_design_preview', id: created.id },
      after: { expiresAt: expiresAt.toISOString() },
      metadata: { principalId: author.principalId },
    })
    const url = new URL('/', config.baseUrl)
    url.searchParams.set(PREVIEW_LINK_PARAM, token)
    return {
      ok: true as const,
      url: url.toString(),
      link: {
        id: created.id,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        createdBy: null,
      },
    }
  })
}

/** The live links, newest first. */
export async function listPreviewLinks(): Promise<PreviewLink[]> {
  const rows = await db
    .select({
      id: links.id,
      createdAt: links.createdAt,
      expiresAt: links.expiresAt,
      displayName: principal.displayName,
      name: user.name,
    })
    .from(links)
    .leftJoin(principal, eq(principal.id, links.createdByPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(live(new Date()))
    .orderBy(desc(links.createdAt), desc(links.id))
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdBy: row.displayName ?? row.name ?? null,
  }))
}

/** Ends a live link; anyone holding it sees the live portal from then on. */
export async function revokePreviewLink(
  id: PortalDesignPreviewId,
  author: DesignAuthor
): Promise<{ ok: true } | PreviewLinkRefusal> {
  return db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(links)
      .set({ revokedAt: new Date() })
      .where(and(eq(links.id, id), isNull(links.revokedAt)))
      .returning({ id: links.id })
    if (!revoked) {
      return {
        ok: false as const,
        code: 'PREVIEW_LINK_NOT_FOUND' as const,
        message: 'That preview link no longer exists.',
      }
    }
    await recordAuditEventInTransaction(tx, {
      event: 'design.preview_link.revoked',
      actor: author.actor,
      headers: author.headers,
      target: { type: 'portal_design_preview', id },
      metadata: { principalId: author.principalId },
    })
    return { ok: true as const }
  })
}

/** What a link's token shows, found by its hash; null for a token no link has. */
export async function readPreviewLink(token: string): Promise<SharedPreview | null> {
  if (!isPreviewToken(token)) return null
  const [row] = await db
    .select({ document: links.document, expiresAt: links.expiresAt, revokedAt: links.revokedAt })
    .from(links)
    .where(eq(links.tokenHash, hashToken(token)))
    .limit(1)
  if (!row) return null
  if (row.revokedAt || row.expiresAt <= new Date()) return { state: 'ended' }
  const design = storedDesign(row.document, 'preview link')
  return design ? { state: 'shown', design } : { state: 'ended' }
}

/** The portal as a link's token draws it, or that the link has ended; null for a token no link has. */
export async function sharedPreviewView(
  token: string
): Promise<{ state: 'shown'; view: PortalDesignView } | { state: 'ended' } | null> {
  const found = await readPreviewLink(token)
  if (found?.state !== 'shown') return found
  return {
    state: 'shown',
    view: portalDesignView({ engine: 'v2', doc: found.design, revision: null }),
  }
}
