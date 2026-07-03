import { slugify } from '@/lib/shared/utils'
import type { TicketFormField } from '@/lib/shared/tickets'

/**
 * Client helpers for the ticket form-field editor. The field-shape rules are the
 * shared `ticketFormFieldSchema` (re-exported here for the editor and its tests);
 * these helpers derive and de-duplicate storage keys purely in the UI.
 */
export { ticketFormFieldSchema } from '@/lib/shared/tickets'

/** Reject a form whose fields collide on `key` before it reaches the server. */
export function findDuplicateKey(fields: Pick<TicketFormField, 'key'>[]): string | null {
  const seen = new Set<string>()
  for (const f of fields) {
    if (seen.has(f.key)) return f.key
    seen.add(f.key)
  }
  return null
}

/** Derive a storage key from a human label (lowercase, underscore-separated). */
export function deriveFieldKey(label: string): string {
  return slugify(label).replace(/-/g, '_')
}

/** A key unique within the given set, suffixing `_2`, `_3`, … on collision. */
export function uniqueFieldKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const seed = base || 'field'
  if (!used.has(seed)) return seed
  for (let i = 2; ; i++) {
    const candidate = `${seed}_${i}`
    if (!used.has(candidate)) return candidate
  }
}
