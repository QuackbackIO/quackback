/**
 * Automatic saves of the draft, so unpublished work can be had back after
 * something replaced it: a discard, Keep mine or Load theirs, a brand match,
 * a large Quackback AI change, an agent's patch over someone else's draft, a
 * restore, or Copy into draft. One is also taken on the first save of an
 * editing session and whenever the last is older than DRAFT_SAVE_EVERY_MS.
 *
 * They live in portal_design_saved as kind `auto`, with a cap of their own,
 * so they never push out a checkpoint or a look a person saved. Each holds
 * the draft exactly as it was stored, and is taken in the transaction of the
 * write that replaces it.
 */
import type { PortalDesignId, PrincipalId } from '@quackback/ids'
import { and, asc, count, desc, eq, portalDesignSaved as saved, type Transaction } from '@/lib/server/db'
import { designChanges } from '@/lib/shared/design/diff'
import { digestOf } from '@/lib/server/utils/canonical-json'
import { storedDesign } from './stored-read'

/** How many automatic draft saves a workspace keeps; the oldest goes when another is taken. */
export const DRAFT_SAVES_KEPT = 30

/** How long editing goes on before another automatic save. */
export const DRAFT_SAVE_EVERY_MS = 30 * 60_000

/** A Quackback AI change this large replaces enough of the draft to save it first. */
export const AI_CHANGES_TO_SAVE = 6

/** Why the draft was saved, as the Versions list names it. */
export const DRAFT_SAVE_NAMES = {
  discard: 'Before discard',
  'keep-mine': 'Before Keep mine',
  'load-theirs': 'Before Load their changes',
  'brand-match': 'Before brand match',
  ai: 'Before Quackback AI',
  agent: 'Before an API change',
  restore: 'Before restore',
  copy: 'Before Copy into draft',
  session: 'Start of editing',
  timer: 'While editing',
} as const

export type DraftSaveCause = keyof typeof DRAFT_SAVE_NAMES

/** The causes a save of the draft can ask for; the rest come from other writes. */
export type SaveDraftCause = Extract<DraftSaveCause, 'keep-mine' | 'brand-match' | 'ai' | 'agent' | 'session'>

interface DraftRow {
  id: PortalDesignId
  draft: unknown
  draftUpdatedByPrincipalId: PrincipalId | null
}

const autoOf = (designId: PortalDesignId) =>
  and(eq(saved.designId, designId), eq(saved.kind, 'auto'))

/**
 * Saves `document`, else the row's draft, as an automatic draft save, unless
 * there is nothing to save or the newest one already holds it, then trims
 * the oldest past DRAFT_SAVES_KEPT. It is credited to whoever saved the
 * draft last, else to `by`. Returns whether one was saved.
 */
export async function saveDraftAside(
  tx: Transaction,
  row: DraftRow,
  cause: DraftSaveCause,
  by: PrincipalId | null,
  document: unknown = row.draft
): Promise<boolean> {
  if (!document) return false
  const [newest] = await tx
    .select({ document: saved.document, at: saved.createdAt })
    .from(saved)
    .where(autoOf(row.id))
    .orderBy(desc(saved.createdAt))
    .limit(1)
  if (newest && digestOf(newest.document) === digestOf(document)) return false
  await tx.insert(saved).values({
    designId: row.id,
    kind: 'auto',
    name: DRAFT_SAVE_NAMES[cause],
    document,
    createdByPrincipalId: document === row.draft ? (row.draftUpdatedByPrincipalId ?? by) : by,
    // Always after the newest, even within one transaction, where now() stands still.
    createdAt: new Date(Math.max(Date.now(), (newest?.at.getTime() ?? 0) + 1)),
  })
  const [{ kept }] = await tx.select({ kept: count() }).from(saved).where(autoOf(row.id))
  if (kept > DRAFT_SAVES_KEPT) {
    const oldest = await tx
      .select({ id: saved.id })
      .from(saved)
      .where(autoOf(row.id))
      .orderBy(asc(saved.createdAt))
      .limit(kept - DRAFT_SAVES_KEPT)
    for (const { id } of oldest) await tx.delete(saved).where(eq(saved.id, id))
  }
  return true
}

/** Whether the last automatic draft save is older than DRAFT_SAVE_EVERY_MS, or there is none. */
async function due(tx: Transaction, designId: PortalDesignId, now: Date): Promise<boolean> {
  const [newest] = await tx
    .select({ at: saved.createdAt })
    .from(saved)
    .where(autoOf(designId))
    .orderBy(desc(saved.createdAt))
    .limit(1)
  return !newest || now.getTime() - newest.at.getTime() >= DRAFT_SAVE_EVERY_MS
}

/**
 * Before a save replaces the draft: saves it aside when the save asked to
 * and its reason holds, or when editing has gone on long enough since the
 * last one. An agent's patch counts only over someone else's draft, and a
 * Quackback AI change only when it changes AI_CHANGES_TO_SAVE things or more.
 */
export async function saveDraftAsideBeforeSave(
  tx: Transaction,
  row: DraftRow,
  next: unknown,
  author: PrincipalId,
  asked: SaveDraftCause | undefined
): Promise<void> {
  if (!row.draft) return
  const holds =
    asked === 'agent'
      ? row.draftUpdatedByPrincipalId !== author
      : asked === 'ai'
        ? designChanges(storedDesign(row.draft, 'draft'), next).length >= AI_CHANGES_TO_SAVE
        : asked !== undefined
  const cause = holds ? asked : (await due(tx, row.id, new Date())) ? 'timer' : null
  if (cause) await saveDraftAside(tx, row, cause, author)
}
