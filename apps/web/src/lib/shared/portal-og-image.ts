/**
 * Portal social share (OG) image resolution.
 *
 * Priority: a custom uploaded OG image beats the workspace logo, which beats
 * the bundled default logo. The portal root's head() uses this so link
 * unfurls show the richest image the workspace has configured. Relative
 * fallbacks are joined to `origin` so crawlers receive an absolute URL.
 */
export function resolvePortalOgImageUrl(
  branding: { ogImageUrl?: string | null; logoUrl?: string | null } | null | undefined,
  origin?: string | null
): string {
  const src = branding?.ogImageUrl || branding?.logoUrl || '/logo.png'
  if (!origin) return src
  try {
    return new URL(src, origin.endsWith('/') ? origin : `${origin}/`).toString()
  } catch {
    return src
  }
}
