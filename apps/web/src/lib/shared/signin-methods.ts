/**
 * Unified sign-in-method enablement. One default table for every surface:
 * password is on unless explicitly disabled; magic-link and social providers
 * are off unless the stored config sets them true. The workspace default
 * (DEFAULT_AUTH_CONFIG) sets google and github to true, so those two are on
 * for a workspace that has not changed its sign-in settings. Credential
 * availability is a separate, server-side gate layered on top of this.
 */
export function isSignInMethodEnabled(
  oauth: Record<string, boolean | undefined> | undefined,
  key: string
): boolean {
  const value = oauth?.[key]
  if (key === 'password') return value !== false
  // magicLink + every social provider key: off unless set to true.
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
