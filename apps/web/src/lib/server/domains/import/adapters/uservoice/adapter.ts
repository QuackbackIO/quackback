/**
 * UserVoice detector + normalizer (§I3): converts the full suggestions
 * export (denormalized — one row per voter) into the wizard's canonical
 * CSV, closing the REST-import attribution gap by feeding the SAME
 * ImportUserResolver-backed pipeline every other source uses.
 *
 * Ported from `scripts/import/adapters/uservoice` (moved in-app rather than
 * shared by re-export: the CLI adapter's signature is file-path-based and
 * produces the CLI's richer IntermediateData shape, while this one works
 * on already-read text and emits the wizard's canonical row shape).
 */
import Papa from 'papaparse'
import { parseCsvCamelCase } from '../camel-case-csv'
import { CANONICAL_CSV_COLUMNS, type ImportVoterRecord, type NormalizedImport } from '../types'
import { normalizeStatus, parseTimestamp } from './field-map'

/** Hallmark columns of UserVoice's full (denormalized) suggestions export. */
const REQUIRED_HEADERS = ['ideaId', 'ideaTitle', 'userEmailAddress']

export function detectUserVoiceExport(headers: string[]): boolean {
  const set = new Set(headers)
  return REQUIRED_HEADERS.every((h) => set.has(h))
}

interface CanonicalRow {
  title: string
  content: string
  status: string
  tags: string
  board: string
  author_name: string
  author_email: string
  vote_count: string
  created_at: string
  source_id: string
}

function parseLabelsField(labels: string | undefined): string {
  if (!labels?.trim()) return ''
  const trimmed = labels.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as string[]
      return parsed.join(',')
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/**
 * Normalizes the full suggestions export CSV into the wizard's canonical
 * CSV plus a real per-idea voter map (this export's one-row-per-voter shape
 * gives us actual voter identities, not just a count).
 */
export function normalizeUserVoiceExport(csvText: string): NormalizedImport {
  const { rows } = parseCsvCamelCase(csvText)

  const posts = new Map<string, CanonicalRow>()
  const voters = new Map<string, Map<string, ImportVoterRecord>>()

  for (const row of rows) {
    const ideaId = row.ideaId?.trim()
    if (!ideaId) continue

    if (!posts.has(ideaId)) {
      const title = row.ideaTitle?.trim()
      if (!title) continue
      posts.set(ideaId, {
        title,
        content: row.ideaDescription?.trim() ?? '',
        status: normalizeStatus(row.publicStatusName),
        tags: parseLabelsField(row.labels),
        board: (row.categoryName || row.forumName || '').trim(),
        author_name: row.ideaCreatorName?.trim() ?? '',
        author_email: row.ideaCreatorEmailAddress?.trim() ?? '',
        vote_count: String(parseInt(row.votersCount || '0', 10) || 0),
        created_at: parseTimestamp(row.createdTimestamp) ?? '',
        source_id: ideaId,
      })
    }

    const voterEmail = row.userEmailAddress?.trim()?.toLowerCase()
    if (voterEmail) {
      if (!voters.has(ideaId)) voters.set(ideaId, new Map())
      const byEmail = voters.get(ideaId)!
      if (!byEmail.has(voterEmail)) {
        byEmail.set(voterEmail, {
          email: voterEmail,
          createdAt: parseTimestamp(row.linkedIdeaCreationDate),
        })
      }
    }
  }

  const canonicalRows = Array.from(posts.values())
  const votersRecord: Record<string, ImportVoterRecord[]> = {}
  for (const [ideaId, byEmail] of voters) {
    votersRecord[ideaId] = Array.from(byEmail.values())
  }

  return {
    csv: Papa.unparse(canonicalRows, { columns: [...CANONICAL_CSV_COLUMNS] }),
    voters: votersRecord,
    caveats: [
      'This export only includes ideas that received at least one vote. Ideas with zero votes are not included and will not be imported.',
    ],
  }
}
