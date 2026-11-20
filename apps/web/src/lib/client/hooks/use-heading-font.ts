import { useEffect } from 'react'
import { resolveBrandingFontId, resolveHeadingFontId } from '@/lib/shared/theme'

/**
 * Loads the listed font the portal's titles and headings are set in, when
 * the theme sets one that is not the text font. Only the cuts headings are
 * drawn in are declared (heading-font-loader.ts), so a portal never fetches
 * a weight it does not show. Mounted by the portal layout alone, beside
 * useBrandingFont and with the same inputs: the widget and the sign-in pages
 * draw no headings in a font of their own, and never carry these modules.
 *
 * Client-side only, as useBrandingFont is: until the stylesheet arrives,
 * headings show in the text font (`font-display: swap`).
 */
export function useHeadingFont(
  customCss: string | null | undefined,
  configFontSans: string | null | undefined,
  configFontHeading: string | null | undefined
): void {
  const headingId = resolveHeadingFontId(customCss, configFontHeading)
  // The text font is already loaded whole.
  const textId = resolveBrandingFontId(customCss, configFontSans)

  useEffect(() => {
    if (!headingId || headingId === textId) return
    // The loader names every family's stylesheet, so it too arrives only for
    // a portal that sets a headings font: most never do.
    import('@/lib/shared/theme/heading-font-loader')
      .then(({ loadHeadingFont }) => loadHeadingFont(headingId))
      .catch(() => {
        // Best-effort: headings stay in the text font.
      })
  }, [headingId, textId])
}
