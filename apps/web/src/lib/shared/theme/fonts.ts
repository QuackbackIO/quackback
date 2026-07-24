import { normalizeFontSans } from './generator'

/**
 * Canonical list of self-hosted branding font families, shared between the
 * admin branding picker (FONT_OPTIONS in use-branding-state.ts, which adds
 * `name`/`category` for the UI) and the on-demand font loader
 * (font-loader.ts). Single source of truth for id <-> font-family value so
 * globals.css, the picker, and the loader can't drift.
 *
 * 'inter' is intentionally excluded — Inter loads statically in globals.css
 * for every page (it's the default/UI font), so it never needs a loader
 * entry. 'system' has no @font-face at all.
 */
export const BRANDING_FONTS = [
  { id: 'inter', value: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  { id: 'system', value: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { id: 'roboto', value: '"Roboto", ui-sans-serif, system-ui, sans-serif' },
  { id: 'open-sans', value: '"Open Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: 'lato', value: '"Lato", ui-sans-serif, system-ui, sans-serif' },
  // Not directly selectable in the admin FONT_OPTIONS picker, but several
  // theme presets in presets.ts (FONTS.nunito) set it as fontSans, so a
  // preset pick alone must still resolve a font id here.
  { id: 'nunito', value: '"Nunito", ui-sans-serif, system-ui, sans-serif' },
  { id: 'poppins', value: '"Poppins", ui-sans-serif, system-ui, sans-serif' },
  { id: 'dm-sans', value: '"DM Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: 'jakarta', value: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif' },
  // @fontsource publishes Geist as the "Geist Sans" family (see globals.css).
  { id: 'geist', value: '"Geist Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: 'manrope', value: '"Manrope", ui-sans-serif, system-ui, sans-serif' },
  { id: 'space-grotesk', value: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif' },
  { id: 'playfair', value: '"Playfair Display", ui-serif, Georgia, serif' },
  { id: 'merriweather', value: '"Merriweather", ui-serif, Georgia, serif' },
  { id: 'lora', value: '"Lora", ui-serif, Georgia, serif' },
  { id: 'fira-code', value: '"Fira Code", ui-monospace, monospace' },
  { id: 'jetbrains', value: '"JetBrains Mono", ui-monospace, monospace' },
] as const

export type BrandingFontId = (typeof BRANDING_FONTS)[number]['id']

/** Also used by FONT_OPTIONS to derive `currentFontId` from a saved --font-sans value. */
export function fontIdForValue(value: string): BrandingFontId | null {
  const match = BRANDING_FONTS.find((f) => f.value === value)
  return match ? match.id : null
}

/**
 * Resolve the branding font id a rendered document should load, given the
 * same two inputs every branded surface (portal, widget, admin preview)
 * already has: the workspace's free-form custom CSS (source of truth — it's
 * what the branding editor's cssText saves, and it cascades last) and the
 * structured theme config's light-mode fontSans (used when there's no custom
 * CSS yet, e.g. a workspace that only picked a preset). Returns null when
 * nothing resolves to a known self-hosted family (covers 'inter', 'system',
 * unset, and legacy/unrecognized values) — callers should treat null as
 * "nothing to dynamically load".
 */
export function resolveBrandingFontId(
  customCss: string | null | undefined,
  configFontSans: string | null | undefined
): BrandingFontId | null {
  const fromCustomCss = customCss ? extractFontSansFromCss(customCss) : null
  const raw = fromCustomCss || configFontSans
  if (!raw) return null
  return fontIdForValue(normalizeFontSans(raw))
}

// The exact `:root { --font-sans: ...; }` shape emitted by generateReadableCSS
// (see generator.ts) — a light regex match rather than the full
// extractCssVariables parser since only this one variable is needed here.
function extractFontSansFromCss(css: string): string | null {
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/)
  if (!rootMatch) return null
  const varMatch = rootMatch[1].match(/--font-sans\s*:\s*([^;]+);/)
  return varMatch ? varMatch[1].trim() : null
}

/**
 * Reads `fontSans` off a persisted BrandingConfig.light/dark blob.
 *
 * The server-side `ThemeColors` type (settings.types.ts) doesn't declare a
 * `fontSans` field, but the branding editor's saveTheme() does write one onto
 * that same JSON blob (brandingConfig is persisted as a loose
 * Record<string, unknown>, not validated against ThemeColors) — so the value
 * is there at runtime even though the server type omits it. Route loaders use
 * this instead of reading `.fontSans` directly so they don't need a `ThemeColors
 * doesn't have fontSans` type error at every call site.
 */
export function readFontSans(colors: object | null | undefined): string | null {
  return (colors as { fontSans?: string } | null | undefined)?.fontSans ?? null
}
