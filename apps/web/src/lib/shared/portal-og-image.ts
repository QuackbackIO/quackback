/**
 * Portal social share (OG) image resolution.
 *
 * Always the workspace logo, then the bundled default. A stored custom OG
 * image is no longer read (`portal_og_image_key` is leftover). Relative
 * fallbacks are joined to `origin` so crawlers receive an absolute URL.
 */
export function resolvePortalOgImageUrl(
  branding: { logoUrl?: string | null } | null | undefined,
  origin?: string | null
): string {
  const src = branding?.logoUrl || '/logo.png'
  if (!origin) return src
  try {
    return new URL(src, origin.endsWith('/') ? origin : `${origin}/`).toString()
  } catch {
    return src
  }
}
