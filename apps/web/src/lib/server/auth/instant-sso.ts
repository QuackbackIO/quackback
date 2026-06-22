/** Pure policy: should an anonymous visitor be sent straight to SSO?
 *  True only when the workspace exposes exactly one public SSO button and
 *  no other sign-in affordance — no password, no magic-link, and no social
 *  OAuth provider (google/github/etc.). The single OIDC provider's own id
 *  is excluded when checking the oauth map because some configs list the
 *  provider by id under the oauth key.
 *  `password` defaults to true (absence ≠ disabled). */
export function resolveInstantSsoProvider(input: {
  publicProviders: { id: string }[]
  portalOauth: Record<string, boolean | undefined>
}): string | null {
  if (input.publicProviders.length !== 1) return null
  const providerId = input.publicProviders[0].id
  const passwordEnabled = input.portalOauth.password ?? true
  const magicLinkEnabled = input.portalOauth.magicLink ?? false
  if (passwordEnabled || magicLinkEnabled) return null
  // Any other enabled key (social OAuth like google/github) means the user
  // has a choice — don't force-redirect to the single OIDC provider.
  const excluded = new Set(['password', 'magicLink', providerId])
  const hasSocialOAuth = Object.entries(input.portalOauth).some(
    ([key, val]) => !excluded.has(key) && val === true
  )
  if (hasSocialOAuth) return null
  return providerId
}
