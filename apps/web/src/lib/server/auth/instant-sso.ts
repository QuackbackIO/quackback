/** Pure policy: should an anonymous visitor be sent straight to SSO?
 *  True only when the workspace exposes exactly one public SSO button and no
 *  public password/magic-link (so the SSO button is the only way in anyway).
 *  `password` defaults to true (absence ≠ disabled). */
export function resolveInstantSsoProvider(input: {
  publicProviders: { id: string }[]
  portalOauth: { password?: boolean; magicLink?: boolean }
}): string | null {
  if (input.publicProviders.length !== 1) return null
  const passwordEnabled = input.portalOauth.password ?? true
  const magicLinkEnabled = input.portalOauth.magicLink ?? false
  if (passwordEnabled || magicLinkEnabled) return null
  return input.publicProviders[0].id
}
