/**
 * The portal's wide logo, when the header shows it: a wordmark in place of
 * the square logo and the workspace name (header_display_mode 'custom_logo').
 * Null in every other mode, so the square logo and name show. Emails, the
 * favicon and share images always use the square logo.
 */
export function portalWideLogoUrl(
  branding: { headerDisplayMode?: string | null; headerLogoUrl?: string | null } | null | undefined
): string | null {
  if (branding?.headerDisplayMode !== 'custom_logo') return null
  return branding.headerLogoUrl || null
}

/**
 * The wide logo's dark mode version, when the header shows the wide logo and
 * the workspace has one: drawn in the logo's place wherever the portal is
 * dark. Null otherwise, and the logo itself shows in both.
 */
export function portalWideLogoDarkUrl(
  branding:
    | {
        headerDisplayMode?: string | null
        headerLogoUrl?: string | null
        headerLogoDarkUrl?: string | null
      }
    | null
    | undefined
): string | null {
  return portalWideLogoUrl(branding) ? branding?.headerLogoDarkUrl || null : null
}

/** How a wide logo sits in a header row: its own shape, never cropped square. */
export const WIDE_LOGO_CLASS = 'h-8 w-auto max-w-[180px] object-contain'
