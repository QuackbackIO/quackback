/**
 * CSV parsing with camelCase header normalization, matching the convention
 * `scripts/import`'s adapters rely on (UserVoice/Canny exports use varied
 * header casing: "Idea Id", "idea_id", "IdeaId" all normalize to "ideaId").
 */
import Papa from 'papaparse'

/**
 * Normalize a header name to camelCase. Already-normalized headers pass
 * through unchanged (Papaparse can invoke transformHeader more than once
 * per header).
 */
export function normalizeHeaderCamelCase(header: string): string {
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(header) || /^[a-z0-9]+$/.test(header)) {
    return header
  }
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('')
}

export function parseCsvCamelCase(csvText: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeaderCamelCase,
    transform: (value) => value.trim(),
  })
  return { headers: result.meta.fields ?? [], rows: result.data }
}
