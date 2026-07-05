/**
 * Shared shapes for the UserVoice/Canny format detectors + normalizers
 * (§I3). A detector/normalizer turns a tool's export into the SAME
 * canonical wizard CSV (title/content/status/tags/board/author_name/
 * author_email/vote_count/created_at/source_id) the plain-CSV path already
 * produces, so it feeds the identical field/status/board mapping steps.
 */
import type { ImportVoterRecord } from '../types'

export type { ImportVoterRecord }

export interface NormalizedImport {
  /** Canonical wizard CSV text (not base64-encoded). */
  csv: string
  /**
   * Real per-row voter records keyed by the row's source_id. Rows absent
   * here fall back to vote-count backfill from the CSV's own vote_count
   * column — the honest "votes-only caveat" the UI surfaces for sources
   * that don't carry individual voter identities.
   */
  voters: Record<string, ImportVoterRecord[]>
  /** User-facing notices about what this format can and can't carry over. */
  caveats: string[]
}

/** Canonical wizard CSV headers, in column order. */
export const CANONICAL_CSV_COLUMNS = [
  'title',
  'content',
  'status',
  'tags',
  'board',
  'author_name',
  'author_email',
  'vote_count',
  'created_at',
  'source_id',
] as const
