/**
 * The portal's own logo, as the workspace's logo too: the admin and emails
 * use the workspace's. Only the light logo goes, and not an SVG, which many
 * email apps do not show.
 */
import type { PortalDesign } from './schema'

/** The design's logo the admin and emails could use: its icon, else its full logo; or null. */
export function workspaceLogoOf(design: PortalDesign): string | null {
  const { mark, wordmark } = design.brand.logo
  const key = mark.light?.key ?? (mark.dark ? undefined : wordmark.light?.key)
  return key && !/\.svg$/i.test(key) ? key : null
}

/** The logo a publish can offer the admin and emails: the draft's, once it differs from what is live. */
export function newWorkspaceLogo(live: PortalDesign, draft: PortalDesign): string | null {
  const key = workspaceLogoOf(draft)
  return key && key !== workspaceLogoOf(live) ? key : null
}
