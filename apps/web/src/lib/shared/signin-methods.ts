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

/**
 * The sign-in methods in force right now, computed at read time from the
 * stored ones.
 *
 * When identity providers are set up but single sign-on is not live (the plan
 * does not include it), email sign-in links are offered even if the stored
 * setting has them off, so a workspace that signs in only through its
 * provider is never left without a way in. Everything else is exactly as
 * stored, and the stored map itself is never changed: once single sign-on is
 * live again, the result is the stored methods with no setup.
 *
 * `ssoLive` is whether single sign-on works right now, not merely whether the
 * plan includes it, so a caller can keep it live for longer than the plan.
 */
export function effectiveSignInMethods(input: {
  stored: Record<string, boolean | undefined> | undefined
  ssoLive: boolean
  providersConfigured: boolean
}): Record<string, boolean | undefined> {
  const stored = { ...input.stored }
  if (input.ssoLive || !input.providersConfigured) return stored
  return { ...stored, magicLink: true }
}
