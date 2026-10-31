import type { BrandingFontId } from './fonts'

/**
 * On-demand loader for self-hosted branding font families.
 *
 * globals.css only ships Inter (the default/UI font) statically. Every other
 * family a workspace can pick lives in its own CSS module under
 * src/styles/fonts/ and is fetched here via a dynamic `import()` — Vite
 * code-splits CSS pulled in through a dynamic import into its own stylesheet,
 * so only the one family a workspace actually uses is ever downloaded, and
 * only by documents that render branding (portal, widget, admin preview).
 *
 * The import specifiers must be static string literals (not built from a
 * variable) so Vite's static analysis can discover and split each one at
 * build time — hence the explicit switch instead of a template-string map.
 *
 * Unknown/legacy ids (and 'inter'/'system', which have nothing to load) fall
 * through to the default case and resolve to a no-op.
 */
export function loadBrandingFont(id: BrandingFontId | string | null | undefined): Promise<unknown> {
  switch (id) {
    case 'roboto':
      return import('@/styles/fonts/roboto.css')
    case 'open-sans':
      return import('@/styles/fonts/open-sans.css')
    case 'lato':
      return import('@/styles/fonts/lato.css')
    case 'nunito':
      return import('@/styles/fonts/nunito.css')
    case 'poppins':
      return import('@/styles/fonts/poppins.css')
    case 'dm-sans':
      return import('@/styles/fonts/dm-sans.css')
    case 'jakarta':
      return import('@/styles/fonts/plus-jakarta-sans.css')
    case 'geist':
      return import('@/styles/fonts/geist-sans.css')
    case 'manrope':
      return import('@/styles/fonts/manrope.css')
    case 'space-grotesk':
      return import('@/styles/fonts/space-grotesk.css')
    case 'inter-tight':
      return import('@/styles/fonts/inter-tight.css')
    case 'sora':
      return import('@/styles/fonts/sora.css')
    case 'outfit':
      return import('@/styles/fonts/outfit.css')
    case 'figtree':
      return import('@/styles/fonts/figtree.css')
    case 'work-sans':
      return import('@/styles/fonts/work-sans.css')
    case 'instrument-sans':
      return import('@/styles/fonts/instrument-sans.css')
    case 'noto-sans':
      return import('@/styles/fonts/noto-sans.css')
    case 'rubik':
      return import('@/styles/fonts/rubik.css')
    case 'karla':
      return import('@/styles/fonts/karla.css')
    case 'libre-franklin':
      return import('@/styles/fonts/libre-franklin.css')
    case 'barlow-condensed':
      return import('@/styles/fonts/barlow-condensed.css')
    case 'oswald':
      return import('@/styles/fonts/oswald.css')
    case 'source-serif':
      return import('@/styles/fonts/source-serif-4.css')
    case 'playfair':
      return import('@/styles/fonts/playfair-display.css')
    case 'merriweather':
      return import('@/styles/fonts/merriweather.css')
    case 'lora':
      return import('@/styles/fonts/lora.css')
    case 'fira-code':
      return import('@/styles/fonts/fira-code.css')
    case 'jetbrains':
      return import('@/styles/fonts/jetbrains-mono.css')
    case 'ibm-plex-sans':
      return import('@/styles/fonts/ibm-plex-sans.css')
    case 'fraunces':
      return import('@/styles/fonts/fraunces.css')
    case 'bricolage-grotesque':
      return import('@/styles/fonts/bricolage-grotesque.css')
    // 'inter' (static in globals.css), 'system' (no @font-face), and any
    // unrecognized/legacy id all resolve to nothing — the generic font
    // stack in the --font-sans value covers rendering in the meantime.
    default:
      return Promise.resolve()
  }
}
