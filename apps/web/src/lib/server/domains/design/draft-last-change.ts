/**
 * The change that moved the draft on, for a person whose save it refused:
 * who saved or published last, and when.
 */
import type { PrincipalId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { designRow, revision } from './design.service'
import { authorNames } from './draft-author-names'

export interface DraftLastChange {
  /** Their name, or You when it was the same person elsewhere. */
  by: string
  /** ISO time of the change. */
  at: string
  kind: 'saved' | 'published'
}

/** The last save of the draft, else the publish that cleared it; null when neither is known. */
export async function draftLastChange(viewer: PrincipalId): Promise<DraftLastChange | null> {
  const row = await designRow(db)
  if (!row) return null
  const published = row.draft ? null : await revision(db, row.publishedRevisionId)
  const change =
    row.draft && row.draftUpdatedAt
      ? { who: row.draftUpdatedByPrincipalId, at: row.draftUpdatedAt, kind: 'saved' as const }
      : published
        ? { who: published.principalId, at: published.createdAt, kind: 'published' as const }
        : null
  if (!change) return null
  const by =
    change.who === viewer
      ? 'You'
      : change.who
        ? ((await authorNames({ by: change.who })).by ?? 'Someone')
        : 'Someone'
  return { by, at: change.at.toISOString(), kind: change.kind }
}
