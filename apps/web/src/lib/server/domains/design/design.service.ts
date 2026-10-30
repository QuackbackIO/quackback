/**
 * A site's portal design: one draft and numbered, immutable published
 * revisions. Every change lands in the draft; publishing turns the draft into
 * the next revision. A publish refuses a draft started from a revision that is
 * no longer published, so two people cannot overwrite each other's work, and
 * restore publishes an old document as a new revision, so nothing is lost.
 */
import type { PortalDesignId, PortalDesignRevisionId, PrincipalId } from '@quackback/ids'
import {
  and,
  db,
  desc,
  eq,
  isNull,
  lt,
  portalDesignRevisions,
  portalDesigns,
  type PortalDesignSource,
  type Transaction,
} from '@/lib/server/db'
import { recordAuditEventInTransaction, type AuditActor } from '@/lib/server/audit/log'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { logger } from '@/lib/server/logger'
import { digestOf } from '@/lib/server/utils/canonical-json'

const log = logger.child({ module: 'design.service' })

/** How many published revisions a site keeps. */
export const REVISIONS_KEPT = 100

export interface DesignAuthor {
  principalId: PrincipalId
  actor: AuditActor
  /** The request, for the audit row's IP and user agent. */
  headers?: Headers
}

export interface DesignState {
  id: PortalDesignId
  published: { revisionId: PortalDesignRevisionId; number: number; document: PortalDesign } | null
  draft: PortalDesign | null
  draftBaseRevisionId: PortalDesignRevisionId | null
}

/** A document checked twice: by the schema, then by the contrast solver. */
export function validateDesign(input: unknown): PortalDesign {
  const parsed = portalDesign.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      'INVALID_DESIGN',
      parsed.error.issues.map((i) => i.message).join('; ')
    )
  }
  const { errors } = resolveDesign(parsed.data)
  if (errors.length > 0) throw new ValidationError('UNREADABLE_DESIGN', errors.join('; '))
  return parsed.data
}

/** The workspace's default site, the only one until sites ship. */
const defaultSite = () => isNull(portalDesigns.siteId)

/** A digest of a parsed draft, so a publish can insist on the draft a person was shown. */
export function draftDigest(draft: unknown): string {
  return digestOf(draft)
}

async function designRow(executor: typeof db | Transaction, lock = false) {
  const query = executor.select().from(portalDesigns).where(defaultSite()).limit(1)
  const [row] = lock ? await query.for('update') : await query
  return row ?? null
}

async function revision(executor: typeof db | Transaction, id: PortalDesignRevisionId | null) {
  if (!id) return null
  const [row] = await executor
    .select()
    .from(portalDesignRevisions)
    .where(eq(portalDesignRevisions.id, id))
    .limit(1)
  return row ?? null
}

export async function getDesignState(): Promise<DesignState | null> {
  const row = await designRow(db)
  if (!row) return null
  const published = await revision(db, row.publishedRevisionId)
  return {
    id: row.id,
    published: published
      ? {
          revisionId: published.id,
          number: published.number,
          document: portalDesign.parse(published.document),
        }
      : null,
    draft: row.draft ? portalDesign.parse(row.draft) : null,
    draftBaseRevisionId: row.draftBaseRevisionId,
  }
}

/** The published revision visitors see, or null when the site has never published one. */
export async function getPublishedRevision(): Promise<{
  document: PortalDesign
  number: number
} | null> {
  const [row] = await db
    .select({ document: portalDesignRevisions.document, number: portalDesignRevisions.number })
    .from(portalDesigns)
    .innerJoin(
      portalDesignRevisions,
      eq(portalDesignRevisions.id, portalDesigns.publishedRevisionId)
    )
    .where(defaultSite())
    .limit(1)
  if (!row) return null
  const parsed = portalDesign.safeParse(row.document)
  if (!parsed.success) {
    // Every revision was validated when it was published, so this is a stored row gone bad.
    log.error(
      { revision: row.number, issues: parsed.error.issues },
      'published design no longer parses'
    )
    return null
  }
  return { document: parsed.data, number: row.number }
}

/** The design visitors see, or null when the site has never published one. */
export async function getPublishedDesign(): Promise<PortalDesign | null> {
  return (await getPublishedRevision())?.document ?? null
}

/** Replaces the draft. A new draft remembers the revision it started from. */
export async function saveDraft(input: unknown, author: DesignAuthor): Promise<void> {
  const document = validateDesign(input)
  await db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    const now = new Date()
    if (!row) {
      await tx.insert(portalDesigns).values({
        draft: document,
        draftBaseRevisionId: null,
        draftUpdatedAt: now,
        draftUpdatedByPrincipalId: author.principalId,
      })
      return
    }
    await tx
      .update(portalDesigns)
      .set({
        draft: document,
        draftBaseRevisionId: row.draft ? row.draftBaseRevisionId : row.publishedRevisionId,
        draftUpdatedAt: now,
        draftUpdatedByPrincipalId: author.principalId,
        updatedAt: now,
      })
      .where(eq(portalDesigns.id, row.id))
  })
}

export async function discardDraft(): Promise<void> {
  await db
    .update(portalDesigns)
    .set({ draft: null, draftBaseRevisionId: null, draftUpdatedAt: null, updatedAt: new Date() })
    .where(defaultSite())
}

/** Writes the next revision, makes it the published one, and trims the oldest. */
async function publishDocument(
  tx: Transaction,
  designId: PortalDesignId,
  document: PortalDesign,
  author: DesignAuthor,
  source: PortalDesignSource,
  message: string | null
) {
  const [latest] = await tx
    .select({ number: portalDesignRevisions.number })
    .from(portalDesignRevisions)
    .where(eq(portalDesignRevisions.designId, designId))
    .orderBy(desc(portalDesignRevisions.number))
    .limit(1)
  const number = (latest?.number ?? 0) + 1
  const [created] = await tx
    .insert(portalDesignRevisions)
    .values({ designId, number, document, source, principalId: author.principalId, message })
    .returning({ id: portalDesignRevisions.id })
  await tx
    .update(portalDesigns)
    .set({
      publishedRevisionId: created.id,
      draft: null,
      draftBaseRevisionId: null,
      draftUpdatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(portalDesigns.id, designId))
  await tx
    .delete(portalDesignRevisions)
    .where(
      and(
        eq(portalDesignRevisions.designId, designId),
        lt(portalDesignRevisions.number, number - REVISIONS_KEPT + 1)
      )
    )
  return { revisionId: created.id, number }
}

export interface PublishDraftInput extends DesignAuthor {
  source: PortalDesignSource
  message?: string
  /** The draft's digest when the publish was asked for; a draft that moved since is refused. */
  expectedDraft?: string
}

export async function publishDraft(
  input: PublishDraftInput
): Promise<{ revisionId: PortalDesignRevisionId; number: number }> {
  const result = await db.transaction((tx) => publishDraftInTransaction(tx, input))
  log.info({ revision: result.number, source: input.source }, 'design published')
  await invalidateSettingsCache()
  return result
}

/** Publishes the draft inside the caller's transaction; the caller clears the settings cache. */
export async function publishDraftInTransaction(
  tx: Transaction,
  input: PublishDraftInput
): Promise<{ revisionId: PortalDesignRevisionId; number: number }> {
  const row = await designRow(tx, true)
  if (!row?.draft) throw new NotFoundError('NO_DRAFT', 'There is no draft to publish.')
  if (row.draftBaseRevisionId !== row.publishedRevisionId) {
    throw new ConflictError(
      'DESIGN_CHANGED',
      'Another version was published after this draft started. Review the draft against it, then publish again.'
    )
  }
  const document = validateDesign(row.draft)
  if (input.expectedDraft && draftDigest(document) !== input.expectedDraft) {
    throw new ConflictError(
      'DRAFT_CHANGED',
      'The draft changed after this was asked for. Ask again to publish the draft as it is now.'
    )
  }
  const published = await publishDocument(
    tx,
    row.id,
    document,
    input,
    input.source,
    input.message ?? null
  )
  await recordAuditEventInTransaction(tx, {
    event: 'design.published',
    actor: input.actor,
    headers: input.headers,
    target: { type: 'portal_design', id: row.id },
    after: { revision: published.number, source: input.source },
    metadata: { principalId: input.principalId, revisionId: published.revisionId },
  })
  return published
}

/** Publishes an old revision's document as the next revision. A draft in progress is kept. */
export async function restoreRevision(
  revisionId: PortalDesignRevisionId,
  author: DesignAuthor
): Promise<{ revisionId: PortalDesignRevisionId; number: number }> {
  const result = await db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    const old = await revision(tx, revisionId)
    if (!row || !old || old.designId !== row.id) {
      throw new NotFoundError('REVISION_NOT_FOUND', 'That version no longer exists.')
    }
    const draft = row.draft
    const draftBase = row.draftBaseRevisionId
    const published = await publishDocument(
      tx,
      row.id,
      portalDesign.parse(old.document),
      author,
      'restore',
      `Restored version ${old.number}`
    )
    if (draft) {
      await tx
        .update(portalDesigns)
        .set({ draft, draftBaseRevisionId: draftBase })
        .where(eq(portalDesigns.id, row.id))
    }
    await recordAuditEventInTransaction(tx, {
      event: 'design.restored',
      actor: author.actor,
      headers: author.headers,
      target: { type: 'portal_design', id: row.id },
      before: { revision: old.number },
      after: { revision: published.number },
      metadata: { principalId: author.principalId, revisionId: published.revisionId },
    })
    return published
  })
  await invalidateSettingsCache()
  return result
}

export async function listRevisions(limit = REVISIONS_KEPT) {
  const row = await designRow(db)
  if (!row) return []
  return db
    .select({
      id: portalDesignRevisions.id,
      number: portalDesignRevisions.number,
      source: portalDesignRevisions.source,
      message: portalDesignRevisions.message,
      principalId: portalDesignRevisions.principalId,
      createdAt: portalDesignRevisions.createdAt,
    })
    .from(portalDesignRevisions)
    .where(eq(portalDesignRevisions.designId, row.id))
    .orderBy(desc(portalDesignRevisions.number))
    .limit(limit)
}
