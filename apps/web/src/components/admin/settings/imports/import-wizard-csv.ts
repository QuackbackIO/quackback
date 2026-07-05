/**
 * Pure CSV helpers for the import mapping wizard (§I2): header auto-mapping,
 * distinct-value extraction for the status/board mapping steps, and
 * rebuilding a canonical CSV once the admin has confirmed every mapping.
 *
 * No DOM/network access here on purpose — this is the part of the wizard
 * that's cheap to unit test.
 */
import Papa from 'papaparse'

export type CanonicalFieldKey =
  | 'title'
  | 'content'
  | 'status'
  | 'tags'
  | 'board'
  | 'author_name'
  | 'author_email'
  | 'vote_count'
  | 'created_at'
  | 'source_id'

export interface CanonicalField {
  key: CanonicalFieldKey
  label: string
  required: boolean
}

/** Order matters: required fields claim their obvious header match first. */
export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: 'title', label: 'Title', required: true },
  { key: 'content', label: 'Content', required: true },
  { key: 'status', label: 'Status', required: false },
  { key: 'board', label: 'Board', required: false },
  { key: 'tags', label: 'Tags', required: false },
  { key: 'author_name', label: 'Author name', required: false },
  { key: 'author_email', label: 'Author email', required: false },
  { key: 'vote_count', label: 'Vote count', required: false },
  { key: 'created_at', label: 'Created at', required: false },
  { key: 'source_id', label: 'Source ID', required: false },
]

/** Header synonyms tried in order; the header itself is always tried first. */
const SYNONYMS: Record<CanonicalFieldKey, string[]> = {
  title: ['title', 'name', 'subject', 'idea_title'],
  content: ['content', 'description', 'body', 'details', 'idea_description'],
  status: ['status', 'state', 'public_status_name'],
  board: ['board', 'category', 'forum', 'category_name', 'forum_name'],
  tags: ['tags', 'labels'],
  author_name: ['author_name', 'author', 'creator', 'creator_name', 'idea_creator_name'],
  author_email: ['author_email', 'email', 'creator_email', 'idea_creator_email_address'],
  vote_count: ['vote_count', 'votes', 'votecount', 'upvotes', 'voters_count'],
  created_at: ['created_at', 'created', 'date', 'timestamp', 'created_timestamp'],
  source_id: ['source_id', 'external_id', 'idea_id'],
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_')
}

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Parses a CSV string (already decoded, not base64) into headers + rows. */
export function parseCsvFile(csvText: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })
  return { headers: result.meta.fields ?? [], rows: result.data }
}

export type FieldMapping = Record<CanonicalFieldKey, string | null>

/**
 * Auto-map uploaded headers onto canonical fields by exact match, then
 * synonym. Each header can back at most one canonical field.
 */
export function autoMapFields(headers: string[]): FieldMapping {
  const normalized = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }))
  const claimed = new Set<string>()
  const mapping = {} as FieldMapping

  for (const field of CANONICAL_FIELDS) {
    const candidates = [field.key, ...SYNONYMS[field.key]]
    let match: string | null = null
    for (const candidate of candidates) {
      const found = normalized.find((h) => h.normalized === candidate && !claimed.has(h.original))
      if (found) {
        match = found.original
        break
      }
    }
    mapping[field.key] = match
    if (match) claimed.add(match)
  }

  return mapping
}

/** Uploaded headers that no canonical field claimed, for the "ignored" notice. */
export function ignoredColumns(headers: string[], mapping: FieldMapping): string[] {
  const mapped = new Set(Object.values(mapping).filter((v): v is string => !!v))
  return headers.filter((h) => !mapped.has(h))
}

const MAX_DISTINCT_VALUES = 200

/** Distinct, non-empty values in a mapped column, in first-seen order. */
export function distinctColumnValues(
  rows: Record<string, string>[],
  sourceColumn: string | null
): string[] {
  if (!sourceColumn) return []
  const seen = new Set<string>()
  const values: string[] = []
  for (const row of rows) {
    const value = row[sourceColumn]?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
    if (values.length >= MAX_DISTINCT_VALUES) break
  }
  return values
}

/** Target slug (or empty string to leave unmapped) per distinct source value. */
export type ValueMapping = Record<string, string>

/**
 * Rebuild a canonical CSV from the raw rows once every mapping is confirmed:
 * renames mapped headers onto the canonical field names the server pipeline
 * expects, and rewrites status/board cells from free-text source values to
 * the resolved target slug.
 */
export function buildRemappedCsv(
  rows: Record<string, string>[],
  fieldMapping: FieldMapping,
  statusValueMapping: ValueMapping,
  boardValueMapping: ValueMapping
): string {
  const canonicalRows = rows.map((row) => {
    const out: Record<string, string> = {}
    for (const field of CANONICAL_FIELDS) {
      const sourceColumn = fieldMapping[field.key]
      const rawValue = sourceColumn ? (row[sourceColumn] ?? '') : ''
      if (field.key === 'status' && rawValue) {
        out.status = statusValueMapping[rawValue] ?? ''
      } else if (field.key === 'board' && rawValue) {
        out.board = boardValueMapping[rawValue] ?? ''
      } else {
        out[field.key] = rawValue
      }
    }
    return out
  })

  return Papa.unparse(canonicalRows, {
    columns: CANONICAL_FIELDS.map((f) => f.key),
  })
}
