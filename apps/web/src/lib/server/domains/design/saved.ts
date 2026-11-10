/**
 * Designs a workspace keeps without publishing them: named checkpoints of the
 * draft, to copy back into it later, looks, to apply as presets are, and
 * automatic draft saves (draft-saves.ts). Each holds the design as it was
 * when saved, read back as this build reads it.
 */
import type { PortalDesignSavedId } from '@quackback/ids'
import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  inArray,
  portalDesignSaved as saved,
  portalDesigns,
  principal,
  user,
  type PortalDesignSavedKind,
} from '@/lib/server/db'
import { lookOf, SAVED_LOOKS_MAX, type DesignLook } from '@/lib/shared/design/looks'
import { withBlockIds } from '@/lib/shared/design/home'
import { portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { migrateDesign } from '@/lib/shared/design/migrations'
import { designRow, storedDesign, type DesignAuthor } from './design.service'
import { saveDraftAside } from './draft-saves'

/** How many checkpoints a workspace keeps; the oldest goes when another is saved. */
export const CHECKPOINTS_KEPT = 20

export interface SavedEntry {
  id: PortalDesignSavedId
  name: string
  createdAt: string
  /** Who saved it, or null once they have left. */
  createdBy: string | null
}

export type SavedRefusal = {
  ok: false
  code: 'SAVED_LOOK_LIMIT' | 'SAVED_NOT_FOUND' | 'INVALID_DESIGN'
  message: string
}

const NOT_FOUND: SavedRefusal = {
  ok: false,
  code: 'SAVED_NOT_FOUND',
  message: 'That was deleted, or can no longer be read.',
}

/** Saves a design, the draft as the person sees it, as a checkpoint or a look. */
export async function saveDesign(
  kind: Exclude<PortalDesignSavedKind, 'auto'>,
  name: string,
  document: unknown,
  author: DesignAuthor
): Promise<{ ok: true; entry: SavedEntry } | SavedRefusal> {
  const parsed = portalDesign.safeParse(migrateDesign(document))
  if (!parsed.success)
    return { ok: false, code: 'INVALID_DESIGN', message: 'That design could not be read.' }
  const design = withBlockIds(parsed.data)
  return db.transaction(async (tx) => {
    await tx.insert(portalDesigns).values({}).onConflictDoNothing()
    // Locked, so two saves at once cannot pass the limit together.
    const row = (await designRow(tx, true))!
    const mine = and(eq(saved.designId, row.id), eq(saved.kind, kind))
    const [{ kept }] = await tx.select({ kept: count() }).from(saved).where(mine)
    if (kind === 'look' && kept >= SAVED_LOOKS_MAX)
      return {
        ok: false as const,
        code: 'SAVED_LOOK_LIMIT' as const,
        message: `A workspace keeps ${SAVED_LOOKS_MAX} looks. Delete one to save another.`,
      }
    if (kind === 'checkpoint' && kept >= CHECKPOINTS_KEPT) {
      const oldest = await tx
        .select({ id: saved.id })
        .from(saved)
        .where(mine)
        .orderBy(asc(saved.createdAt))
        .limit(kept - CHECKPOINTS_KEPT + 1)
      for (const { id } of oldest) await tx.delete(saved).where(eq(saved.id, id))
    }
    const [created] = await tx
      .insert(saved)
      .values({
        designId: row.id,
        kind,
        name,
        document: design,
        createdByPrincipalId: author.principalId,
      })
      .returning({ id: saved.id, createdAt: saved.createdAt })
    return {
      ok: true as const,
      entry: { id: created.id, name, createdAt: created.createdAt.toISOString(), createdBy: null },
    }
  })
}

/**
 * Saves the draft aside before the builder replaces it, such as by Copy into
 * draft, or the person's own unsaved draft before they load someone else's,
 * as an automatic draft save.
 */
export async function saveDraftAsideNow(
  cause: 'copy' | 'load-theirs',
  author: DesignAuthor,
  document?: unknown
): Promise<{ ok: true; saved: boolean } | SavedRefusal> {
  let design: PortalDesign | undefined
  if (document !== undefined) {
    const parsed = portalDesign.safeParse(migrateDesign(document))
    if (!parsed.success)
      return { ok: false, code: 'INVALID_DESIGN', message: 'That design could not be read.' }
    design = withBlockIds(parsed.data)
  }
  return db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    if (!row) return { ok: true as const, saved: false }
    return {
      ok: true as const,
      saved: await saveDraftAside(tx, row, cause, author.principalId, design ?? row.draft),
    }
  })
}

/**
 * The checkpoints, looks and automatic draft saves kept, newest first; a look
 * comes with what it sets.
 */
export async function listSaved(): Promise<{
  checkpoints: SavedEntry[]
  looks: Array<SavedEntry & { look: DesignLook }>
  drafts: SavedEntry[]
}> {
  const row = await designRow(db)
  if (!row) return { checkpoints: [], looks: [], drafts: [] }
  const rows = await db
    .select({
      id: saved.id,
      kind: saved.kind,
      name: saved.name,
      document: saved.document,
      createdAt: saved.createdAt,
      createdBy: user.name,
    })
    .from(saved)
    .leftJoin(principal, eq(principal.id, saved.createdByPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(saved.designId, row.id))
    .orderBy(desc(saved.createdAt))
  const entry = (each: (typeof rows)[number]): SavedEntry => ({
    id: each.id,
    name: each.name,
    createdAt: each.createdAt.toISOString(),
    createdBy: each.createdBy ?? null,
  })
  const looks: Array<SavedEntry & { look: DesignLook }> = []
  for (const each of rows.filter((one) => one.kind === 'look')) {
    const design = storedDesign(each.document, `saved look ${each.id}`)
    if (design) looks.push({ ...entry(each), look: lookOf(design) })
  }
  return {
    checkpoints: rows.filter((one) => one.kind === 'checkpoint').map(entry),
    looks,
    drafts: rows.filter((one) => one.kind === 'auto').map(entry),
  }
}

/** A checkpoint's or an automatic draft save's design, to copy into the draft. */
export async function readCheckpoint(
  id: PortalDesignSavedId
): Promise<{ ok: true; design: PortalDesign; name: string } | SavedRefusal> {
  const row = await designRow(db)
  if (!row) return NOT_FOUND
  const [found] = await db
    .select({ name: saved.name, document: saved.document })
    .from(saved)
    .where(
      and(eq(saved.id, id), eq(saved.designId, row.id), inArray(saved.kind, ['checkpoint', 'auto']))
    )
    .limit(1)
  const design = found ? storedDesign(found.document, `checkpoint ${id}`) : null
  return design && found ? { ok: true, design, name: found.name } : NOT_FOUND
}

/** Deletes a checkpoint or a look. */
export async function deleteSaved(id: PortalDesignSavedId): Promise<{ ok: true } | SavedRefusal> {
  const row = await designRow(db)
  if (!row) return NOT_FOUND
  const gone = await db
    .delete(saved)
    .where(and(eq(saved.id, id), eq(saved.designId, row.id)))
    .returning({ id: saved.id })
  return gone.length ? { ok: true } : NOT_FOUND
}
