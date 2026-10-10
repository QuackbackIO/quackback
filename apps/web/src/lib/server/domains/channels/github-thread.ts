/** GitHub logins are case-insensitive. */
export function githubLoginsMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

/** Correlation key for a GitHub issue on a channel account. */
export function githubThreadKey(ownerRepo: string, issueNumber: number | string): string {
  return `${ownerRepo}#${issueNumber}`
}

export function parseGitHubThreadKey(
  key: string
): { ownerRepo: string; issueNumber: string } | null {
  const hash = key.lastIndexOf('#')
  if (hash <= 0 || hash === key.length - 1) return null
  const ownerRepo = key.slice(0, hash)
  const issueNumber = key.slice(hash + 1)
  if (!ownerRepo.includes('/') || !/^\d+$/.test(issueNumber)) return null
  return { ownerRepo, issueNumber }
}
