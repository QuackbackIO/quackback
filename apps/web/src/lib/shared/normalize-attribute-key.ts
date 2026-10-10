/** Normalize a machine key: trimmed, lowercased, whitespace to underscores. */
export function normalizeAttributeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}
