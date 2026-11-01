/**
 * Reads today's branding settings as a portal design. Pure and deterministic,
 * so a workspace with no hand-written CSS can render through the design
 * engine without any stored data changing.
 */
import { DEFAULT_DARK_BASE, DEFAULT_LIGHT_BASE } from '@/lib/shared/theme/expand'
import { normalizeFontSans } from '@/lib/shared/theme/generator'
import type { ThemeConfig, ThemeVariables } from '@/lib/shared/theme/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { normaliseColor } from './color'
import { bundledFontStack } from './fonts'
import { BUNDLED_FONT_IDS } from './options'
import { defaultDesign, type PortalDesign } from './schema'

/**
 * Tokens a design works out rather than stores, so a converted portal shows
 * the derived value where today's settings held their own: secondary and hover
 * surfaces, error and success colours, the focus ring, and the radius, which
 * snaps to one of four corner styles.
 */
export const CONVERSION_DELTA_TOKENS = [
  'secondary',
  'secondaryForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'success',
  'ring',
  'radius',
] as const

interface LegacyNavItem {
  id?: string
  type: string
  enabled?: boolean
  label?: string
  url?: string
  newTab?: boolean
}

export interface LegacyBranding {
  brandingConfig: (ThemeConfig & { preset?: string }) | null
  portalConfig?: {
    welcomeCard?: { body?: TiptapContent | unknown }
    nav?: { items?: LegacyNavItem[] }
  }
  logoKey?: string | null
  headerLogoKey?: string | null
  faviconKey?: string | null
  headerDisplayMode?: string | null
  headerDisplayName?: string | null
}

type Palette = PortalDesign['brand']['light']

function color(value: unknown): string | undefined {
  return typeof value === 'string' ? (normaliseColor(value) ?? undefined) : undefined
}

/** A legacy colour set as a palette; required colours fall back to today's base. */
function palette(vars: ThemeVariables | undefined, base: typeof DEFAULT_LIGHT_BASE): Palette {
  const background = color(vars?.background) ?? color(base.background)!
  const surface = color(vars?.card)
  const out: Palette = {
    accent: color(vars?.primary) ?? color(base.primary)!,
    background,
    ink: color(vars?.foreground) ?? color(base.foreground)!,
    surface: surface !== background ? surface : undefined,
    raised: color(vars?.muted),
    muted: color(vars?.mutedForeground),
    border: color(vars?.border),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Palette
}

function corners(radius: unknown): PortalDesign['shape']['corners'] {
  if (typeof radius !== 'string') return 'rounded'
  const match = /^(\d+(?:\.\d+)?)(rem|px|em)?$/.exec(radius.trim())
  if (!match) return 'rounded'
  const rem = match[2] === 'px' ? Number(match[1]) / 16 : Number(match[1])
  if (rem === 0) return 'sharp'
  if (rem <= 0.375) return 'subtle'
  if (rem <= 0.75) return 'rounded'
  return 'pill'
}

/** The first family in a font stack, unquoted and lowercased. */
export function leadingFamily(stack: string): string {
  return stack
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
}

/** The bundled font a saved stack leads with; presets wrote stacks that differ after the first family. */
function bodyFont(fontSans: unknown): PortalDesign['brand']['fonts']['body'] {
  if (typeof fontSans !== 'string') return { kind: 'bundled', id: 'inter' }
  const family = leadingFamily(normalizeFontSans(fontSans))
  const id = BUNDLED_FONT_IDS.find((font) => leadingFamily(bundledFontStack(font)) === family)
  return { kind: 'bundled', id: id ?? 'inter' }
}

const DISPLAY: Record<string, PortalDesign['brand']['logo']['display']> = {
  logo_and_name: 'mark_and_name',
  logo_only: 'mark',
  custom_logo: 'wordmark',
}

const PAGE_TYPES = ['feedback', 'roadmap', 'changelog', 'help', 'support', 'status'] as const
type PageType = (typeof PAGE_TYPES)[number]
const isPage = (type: string): type is PageType => (PAGE_TYPES as readonly string[]).includes(type)

/** Today's menu: saved order and labels, Feedback always shown, missing pages appended. */
function navItems(items: LegacyNavItem[] | undefined): PortalDesign['nav']['items'] {
  const out: PortalDesign['nav']['items'] = []
  const seen = new Set<string>()
  for (const item of items ?? []) {
    if (item.type === 'link') {
      if (!item.url || !/^https?:\/\//i.test(item.url) || !item.label?.trim()) continue
      out.push({
        type: 'link',
        id: (item.id ?? `link-${out.length}`).slice(0, 40),
        label: item.label.trim().slice(0, 40),
        url: item.url,
        newTab: item.newTab !== false,
      })
    } else if (isPage(item.type) && !seen.has(item.type)) {
      seen.add(item.type)
      const shown = item.type === 'feedback' || item.enabled !== false
      const label = item.label?.trim()
      out.push({ type: item.type, shown, ...(label ? { label: label.slice(0, 40) } : {}) })
    }
  }
  for (const type of PAGE_TYPES) if (!seen.has(type)) out.push({ type, shown: true })
  return out
}

export function convertLegacyBranding(legacy: LegacyBranding): PortalDesign {
  const config = legacy.brandingConfig ?? {}
  const doc = defaultDesign()
  const lightVars = config.light
  const darkVars = config.dark

  doc.mode = config.themeMode === 'light' ? 'light' : config.themeMode === 'dark' ? 'dark' : 'auto'
  if (typeof config.preset === 'string' && config.preset.length <= 40) doc.basedOn = config.preset

  doc.brand.light = palette(lightVars, DEFAULT_LIGHT_BASE)
  // Today's dark mode reads only the dark settings, falling back to its own
  // base, so the dark accent is carried rather than borrowed from light.
  doc.brand.dark = palette(darkVars, DEFAULT_DARK_BASE)

  const font = bodyFont(lightVars?.fontSans)
  doc.brand.fonts = { heading: font, body: font, headingWeight: 600 }
  doc.shape.corners = corners(lightVars?.radius)

  const asset = (key: string | null | undefined) => (key ? { key } : null)
  doc.brand.logo = {
    mark: { light: asset(legacy.logoKey), dark: null },
    wordmark: { light: asset(legacy.headerLogoKey), dark: null },
    display: DISPLAY[legacy.headerDisplayMode ?? ''] ?? 'mark_and_name',
    ...(legacy.headerDisplayName?.trim()
      ? { name: legacy.headerDisplayName.trim().slice(0, 60) }
      : {}),
  }
  doc.brand.favicon = asset(legacy.faviconKey)

  const body = legacy.portalConfig?.welcomeCard?.body as TiptapContent | undefined
  if (body && typeof body === 'object') {
    doc.pages.feedback.welcome = { show: !isEmptyTiptapDoc(body), body }
  }
  doc.nav.items = navItems(legacy.portalConfig?.nav?.items)
  return doc
}
