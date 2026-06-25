/**
 * Unified sign-in-method enablement. One default table for every surface:
 * password is on unless explicitly disabled; magic-link and social providers
 * are opt-in (off unless explicitly true). Credential availability is a
 * separate, server-side gate layered on top of this.
 */
export function isSignInMethodEnabled(
  oauth: Record<string, boolean | undefined> | undefined,
  key: string
): boolean {
  const value = oauth?.[key]
  if (key === 'password') return value !== false
  // magicLink + every social provider key: opt-in.
  return value === true
}

/** Map a path-derived Better-Auth provider id to its `authConfig.oauth` key. */
export function normalizeMethodKey(provider: string): string {
  if (provider === 'credential' || provider === 'password') return 'password'
  if (provider === 'magic-link' || provider === 'magicLink' || provider === 'email') {
    return 'magicLink'
  }
  return provider
}
