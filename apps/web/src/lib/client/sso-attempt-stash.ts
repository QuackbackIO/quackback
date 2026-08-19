/**
 * Remembers the last OAuth/OIDC sign-in attempt across the full-page
 * redirect to the IdP and back. When the callback fails with
 * `account_not_linked` (an existing local account isn't yet verified /
 * linked), Better-Auth's error redirect carries only the error code —
 * not which provider was tried or which email the user typed. This
 * stash restores that context so the link-conflict recovery flow can
 * resume the exact attempt after the user confirms their email.
 *
 * sessionStorage scope is intentional: per-tab, cleared when the tab
 * closes, never sent to the server.
 */

export interface SsoAttempt {
  providerId: string
  providerType: 'oidc' | 'social'
  /** Email the user typed before routing to SSO, when known. */
  email?: string
  /** Where the sign-in intended to land. */
  callbackUrl?: string
  ts: number
}

const KEY = 'qb-sso-attempt'
// A conflict recovery only makes sense for the attempt the user just
// made; anything older is a stale leftover from an abandoned sign-in.
const MAX_AGE_MS = 15 * 60 * 1000

export function stashSsoAttempt(attempt: Omit<SsoAttempt, 'ts'>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...attempt, ts: Date.now() }))
  } catch {
    // Storage unavailable (private mode quotas, disabled) — recovery
    // degrades to the email-entry fallback, sign-in itself is unaffected.
  }
}

/** Read-and-clear. Returns null when absent, malformed, or expired. */
export function takeSsoAttempt(): SsoAttempt | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SsoAttempt>
    if (
      typeof parsed.providerId !== 'string' ||
      (parsed.providerType !== 'oidc' && parsed.providerType !== 'social') ||
      typeof parsed.ts !== 'number' ||
      Date.now() - parsed.ts > MAX_AGE_MS
    ) {
      return null
    }
    return parsed as SsoAttempt
  } catch {
    return null
  }
}
