/**
 * The identities product analytics files events under, shared by every app
 * that reports to the same project, so one person and one workspace read as
 * one funnel from first visit to daily use.
 *
 * A person is their email: separate databases give the same person different
 * user ids, but each of them knows the email.
 */
export function analyticsDistinctId(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  return normalized ? normalized : null
}

/**
 * A workspace is a one-way hash of its workspace key (or, on a
 * single-workspace install, its settings row id). The key itself is an
 * ownership stamp and never leaves the server; the hash only groups events.
 * Any app holding the key reproduces it as
 * `ws_` + the first 24 hex chars of sha256(`quackback-analytics-workspace:<key>`).
 */
export async function analyticsWorkspaceKey(
  workspaceKey: string | null | undefined,
  settingsId: string | null | undefined
): Promise<string | null> {
  const source = workspaceKey || settingsId
  if (!source) return null
  const bytes = new TextEncoder().encode(`quackback-analytics-workspace:${source}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  return `ws_${hex.slice(0, 24)}`
}
