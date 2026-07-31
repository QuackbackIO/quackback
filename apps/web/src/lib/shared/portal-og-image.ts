/**
 * Portal social share (OG) image resolution.
 *
 * Priority: a custom uploaded OG image beats the workspace logo, which beats
 * the bundled default logo. The portal root's head() uses this so link
 * unfurls show the richest image the workspace has configured.
 */
export function resolvePortalOgImageUrl(
  branding: { ogImageUrl?: string | null; logoUrl?: string | null } | null | undefined
): string {
  return branding?.ogImageUrl || branding?.logoUrl || '/logo.png'
}
