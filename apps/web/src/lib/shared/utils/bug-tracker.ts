function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Leading-word-boundary match so "issue" catches "issues"/"issued" but not
 * "tissue", and "bug" doesn't false-positive inside "debug".
 */
export function matchesBugTrackerKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => {
    const trimmed = kw.trim()
    return trimmed.length > 0 && new RegExp(`\\b${escapeRegExp(trimmed)}`, 'i').test(text)
  })
}
