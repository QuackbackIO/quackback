import { useEffect } from 'react'
import { loadBrandingFont, resolveBrandingFontId } from '@/lib/shared/theme'

/**
 * Loads the workspace's chosen branding font on demand, client-side only.
 *
 * globals.css only ships Inter (the default/UI font) statically — every
 * other self-hosted family lives in its own CSS module and arrives via a
 * dynamic `import()` (see font-loader.ts), so a page only ever downloads the
 * one family it actually renders. Mount this once per branded surface
 * (portal layout, widget layout, admin branding preview) with the same
 * `customCss`/`configFontSans` inputs the surface already renders into a
 * `<style>` tag.
 *
 * Deliberately not SSR'd: the hashed asset URL Vite gives each font module
 * isn't addressable server-side, so the chosen family arrives one async
 * stylesheet after first paint (FOUT, accepted trade-off — @fontsource's CSS
 * already sets font-display: swap). A future refinement could inject a
 * preload/link server-side once the manifest is queryable at request time.
 */
export function useBrandingFont(
  customCss: string | null | undefined,
  configFontSans: string | null | undefined
): void {
  const fontId = resolveBrandingFontId(customCss, configFontSans)

  useEffect(() => {
    if (!fontId) return
    loadBrandingFont(fontId).catch(() => {
      // Best-effort: a failed font fetch (offline, blocked asset host) just
      // leaves the --font-sans generic fallback stack rendering — never
      // throw out of a layout effect over a stylesheet.
    })
  }, [fontId])
}
