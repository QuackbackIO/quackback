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
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { sameDesign } from '@/lib/shared/design/diff'
import { withoutOrphanedOverrides } from '@/lib/shared/design/override-cascade'
import { logger } from '@/lib/server/logger'
import { digestOf } from '@/lib/server/utils/canonical-json'
import { authorKey, recordAuthors, type DraftAuthors } from './draft-authors'
import { draftRevision, EMPTY_REVISION } from './draft-revision'
import { dropDraft, NO_DRAFT } from './no-draft'
import { assertWritable, storedDesign, storedRead } from './stored-read'
import { validateDesign } from './validate-design'

export { storedDesign, validateDesign }

const log = logger.child({ module: 'design.service' })

/** How many published revisions a site keeps. */
export const REVISIONS_KEPT = 100

export interface DesignAuthor {
  principalId: PrincipalId
  /** Quackback AI, acting for the principal. */
  via?: 'ai'
  actor: AuditActor
  /** The request, for the audit row's IP and user agent. */
  headers?: Headers
}

export interface DesignState {
  id: PortalDesignId
  published: { revisionId: PortalDesignRevisionId; number: number; document: PortalDesign } | null
  draft: PortalDesign | null
  draftBaseRevisionId: PortalDesignRevisionId | null
  /** What the draft being edited is known by; see draftRevision. */
  revision: string
  /** Who made each change the draft holds; see draft-authors.ts. */
  authors: DraftAuthors | null
  /** When the draft was last saved, or null without a draft. */
  draftSavedAt: Date | null
  /**
   * Whether a newer build saved the draft or the published version: this build
   * reads it without what it does not know, and refuses to write it back.
   */
  newerFormat: boolean
}

/**
 * Custom CSS is a plan feature. CSS the published design already has stays,
 * and removing it is always allowed, so a workspace whose plan dropped the
 * feature can still save everything else.
 */
async function assertCssAllowed(
  executor: typeof db | Transaction,
  document: PortalDesign,
  publishedRevisionId: PortalDesignRevisionId | null
): Promise<void> {
  const css = document.css?.trim() ?? ''
  if (!css) return
  const published = await revision(executor, publishedRevisionId)
  const live = published ? storedDesign(published.document, 'published')?.css?.trim() : undefined
  if (css === live) return
  const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
  await assertTierFeature('customCss', 'Custom CSS')
}

/** The workspace's default site, the only one until sites ship. */
const defaultSite = () => isNull(portalDesigns.siteId)

/** A digest of a parsed draft, so a publish can insist on the draft a person was shown. */
export function draftDigest(draft: unknown): string {
  return digestOf(draft)
}

export async function designRow(executor: typeof db | Transaction, lock = false) {
  const query = executor.select().from(portalDesigns).where(defaultSite()).limit(1)
  const [row] = lock ? await query.for('update') : await query
  return row ?? null
}

export async function revision(
  executor: typeof db | Transaction,
  id: PortalDesignRevisionId | null
) {
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
  const live = published ? storedRead(published.document, 'published') : null
  const draft = row.draft ? storedRead(row.draft, 'draft') : null
  return {
    id: row.id,
    published:
      published && live
        ? { revisionId: published.id, number: published.number, document: live.design }
        : null,
    draft: draft?.design ?? null,
    draftBaseRevisionId: row.draftBaseRevisionId,
    revision: draftRevision(row),
    authors: row.draft ? (row.draftAuthors ?? null) : null,
    draftSavedAt: row.draft ? (row.draftUpdatedAt ?? null) : null,
    newerFormat: !!live?.newer || !!draft?.newer,
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
  const document = storedDesign(row.document, `revision ${row.number}`)
  return document ? { document, number: row.number } : null
}

/** The design visitors see, or null when the site has never published one. */
export async function getPublishedDesign(): Promise<PortalDesign | null> {
  return (await getPublishedRevision())?.document ?? null
}

/**
 * Replaces the draft, returning its new revision; refuses a stale
 * `expectedRevision`. Visitors see the published design, or `unpublished`
 * before the first publish.
 */
export async function saveDraft(
  input: unknown,
  author: DesignAuthor,
  expectedRevision?: string,
  unpublished?: () => Promise<PortalDesign>
): Promise<string> {
  const document = validateDesign(input)
  // Read before the transaction: `unpublished` reads on the global pool, and
  // inside the transaction it would wait on itself when the pool has one connection.
  const fallback = await unpublished?.()
  return db.transaction(async (tx) => {
    let row = await designRow(tx, true)
    if (!row) {
      // Two first saves can meet here, such as a person's and Quackback AI's;
      // the second waits for the first's row and then updates it.
      await tx.insert(portalDesigns).values({}).onConflictDoNothing()
      row = (await designRow(tx, true))!
    }
    if (expectedRevision !== undefined && expectedRevision !== draftRevision(row))
      throw new ConflictError('REVISION_MISMATCH', 'The draft changed since you opened it.')
    await assertWritable(tx, row)
    // Saving the draft as it is changes nothing, so its revision stays where it is.
    if (row.draft && draftDigest(row.draft) === draftDigest(document)) return draftRevision(row)
    const published = await revision(tx, row.publishedRevisionId)
    const live = published ? storedDesign(published.document, 'published') : fallback
    // A draft put back to what visitors see is no draft, so nothing says one is waiting.
    if (live && sameDesign(live, document)) return dropDraft(tx, row)
    await assertCssAllowed(tx, document, row.publishedRevisionId)
    const now = new Date()
    // Read as this build reads them, so a draft stored in an older format marks only what changed.
    const before = row.draft ? storedDesign(row.draft, 'draft') : published ? live : null
    const by = authorKey(author.principalId, author.via)
    await tx
      .update(portalDesigns)
      .set({
        draft: document,
        draftBaseRevisionId: row.draft ? row.draftBaseRevisionId : row.publishedRevisionId,
        draftUpdatedAt: now,
        draftVersion: row.draftVersion + 1,
        draftUpdatedByPrincipalId: author.principalId,
        draftAuthors: recordAuthors(row.draft ? row.draftAuthors : null, before, document, by),
        updatedAt: now,
      })
      .where(eq(portalDesigns.id, row.id))
    return draftRevision({ ...row, draft: document, draftVersion: row.draftVersion + 1 })
  })
}

/**
 * Drops the draft, returning the revision the next save names; refuses a
 * stale `expectedRevision`, so a discard never throws away changes someone
 * saved after the person last looked.
 */
export async function discardDraft(expectedRevision?: string): Promise<string> {
  return db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    if (!row) return EMPTY_REVISION
    if (expectedRevision !== undefined && expectedRevision !== draftRevision(row))
      throw new ConflictError('REVISION_MISMATCH', 'The draft changed since you opened it.')
    await assertWritable(tx, row)
    return dropDraft(tx, row)
  })
}

/**
 * Writes the next revision, without overrides whose part is gone, makes it
 * the published one, and trims the oldest.
 */
async function publishDocument(
  tx: Transaction,
  designId: PortalDesignId,
  given: PortalDesign,
  author: Pick<DesignAuthor, 'principalId'> | null,
  source: PortalDesignSource,
  message: string | null
) {
  const document = withoutOrphanedOverrides(given)
  const [latest] = await tx
    .select({ number: portalDesignRevisions.number })
    .from(portalDesignRevisions)
    .where(eq(portalDesignRevisions.designId, designId))
    .orderBy(desc(portalDesignRevisions.number))
    .limit(1)
  const number = (latest?.number ?? 0) + 1
  const [created] = await tx
    .insert(portalDesignRevisions)
    .values({
      designId,
      number,
      document,
      source,
      principalId: author?.principalId ?? null,
      message,
    })
    .returning({ id: portalDesignRevisions.id })
  await tx
    .update(portalDesigns)
    .set({
      publishedRevisionId: created.id,
      ...NO_DRAFT,
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
  /** The draft revision the person reviewed; a draft that moved since is refused. */
  expectedRevision?: string
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
  await assertWritable(tx, row)
  if (row.draftBaseRevisionId !== row.publishedRevisionId) {
    throw new ConflictError(
      'DESIGN_CHANGED',
      'Another version was published after this draft started. Review the draft against it, then publish again.'
    )
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== draftRevision(row))
    throw new ConflictError('REVISION_MISMATCH', 'The draft changed since you reviewed it.')
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

/**
 * Publishes the design a new workspace starts with as its first version, from
 * setup rather than a person. A workspace with a design keeps it; the result
 * says whether this one was published.
 */
export async function publishStartingDesign(
  tx: Transaction,
  document: PortalDesign
): Promise<boolean> {
  await tx.insert(portalDesigns).values({}).onConflictDoNothing()
  const row = (await designRow(tx, true))!
  if (row.publishedRevisionId || row.draft) return false
  await publishDocument(tx, row.id, validateDesign(document), null, 'conversion', null)
  return true
}

/**
 * Publishes a workspace's design for the first time, from its own theme and
 * CSS, at a person's request. Refused once a design is published.
 */
export async function publishSwitchedDesign(
  document: PortalDesign,
  author: DesignAuthor
): Promise<{ revisionId: PortalDesignRevisionId; number: number }> {
  const valid = validateDesign(document)
  const result = await db.transaction(async (tx) => {
    await tx.insert(portalDesigns).values({}).onConflictDoNothing()
    const row = (await designRow(tx, true))!
    if (row.publishedRevisionId) {
      throw new ConflictError('DESIGN_CHANGED', 'This portal already uses the design system.')
    }
    // Publishing clears the draft, which a newer build may have saved.
    await assertWritable(tx, row)
    const published = await publishDocument(
      tx,
      row.id,
      valid,
      author,
      'conversion',
      'Switched from custom CSS'
    )
    await recordAuditEventInTransaction(tx, {
      event: 'design.switched',
      actor: author.actor,
      headers: author.headers,
      target: { type: 'portal_design', id: row.id },
      after: { revision: published.number },
      metadata: { principalId: author.principalId, revisionId: published.revisionId },
    })
    return published
  })
  await invalidateSettingsCache()
  return result
}

/**
 * Takes the published design off the portal, so the old theme shows again.
 * Its versions and any draft stay, ready to publish again.
 */
export async function unpublishDesign(author: DesignAuthor): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    if (!row?.publishedRevisionId) {
      throw new ConflictError(
        'NOT_SWITCHED',
        'This portal has no published design to switch back from.'
      )
    }
    const published = await revision(tx, row.publishedRevisionId)
    await tx
      .update(portalDesigns)
      .set({ publishedRevisionId: null, updatedAt: new Date() })
      .where(eq(portalDesigns.id, row.id))
    await recordAuditEventInTransaction(tx, {
      event: 'design.switched_back',
      actor: author.actor,
      headers: author.headers,
      target: { type: 'portal_design', id: row.id },
      before: { revision: published?.number ?? null },
      metadata: { principalId: author.principalId },
    })
  })
  await invalidateSettingsCache()
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
    await assertWritable(tx, row, old.document)
    const draft = row.draft
    const document = storedDesign(old.document, `revision ${old.number}`)
    if (!document)
      throw new NotFoundError('REVISION_NOT_FOUND', 'That version can no longer be read.')
    // A version's CSS goes live again only on a plan that has it, unless visitors see it now.
    await assertCssAllowed(tx, document, row.publishedRevisionId)
    const published = await publishDocument(
      tx,
      row.id,
      document,
      author,
      'restore',
      `Restored version ${old.number}`
    )
    // A draft kept through a restore now builds on the restored version, with its authors.
    if (draft) {
      await tx
        .update(portalDesigns)
        .set({
          draft,
          draftBaseRevisionId: published.revisionId,
          draftUpdatedAt: row.draftUpdatedAt,
          draftUpdatedByPrincipalId: row.draftUpdatedByPrincipalId,
          draftAuthors: row.draftAuthors,
        })
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
