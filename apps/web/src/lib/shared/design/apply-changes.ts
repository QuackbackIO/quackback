/**
 * The design fields Quackback AI may change, and how its changes reach a
 * draft. Each change is applied on its own and kept only when the design
 * still passes the schema and the contrast solver, so a bad suggestion drops
 * out without taking the good ones with it. Quackback AI never writes CSS.
 */
import { normaliseColor } from '@/lib/shared/design/color'
import { BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { portalDesign, type PortalDesign } from '@/lib/shared/design/schema'

const PALETTE = ['accent', 'background', 'ink', 'surface', 'raised', 'muted', 'border'] as const
const LAYOUT = ['header', 'nav', 'band', 'cards', 'density', 'width', 'filters'] as const

/** Every path Quackback AI may set. */
export const DESIGN_AI_PATHS = [
  'mode',
  ...PALETTE.map((key) => `brand.light.${key}`),
  ...PALETTE.filter((key) => key !== 'accent').map((key) => `brand.dark.${key}`),
  'brand.fonts.heading',
  'brand.fonts.body',
  'brand.fonts.headingWeight',
  'shape.corners',
  ...LAYOUT.map((key) => `layout.${key}`),
  'pages.feedback.headline.title',
  'pages.feedback.headline.subtitle',
  'pages.feedback.welcome.show',
  'pages.feedback.defaultSort',
] as const

/** The part of the portal a request is about; a section scope reaches only its own paths. */
export const DESIGN_AI_SCOPES = [
  'site',
  'brand',
  'header',
  'band',
  'welcome',
  'feed',
  'filters',
] as const
export type DesignAiScope = (typeof DESIGN_AI_SCOPES)[number]

const SCOPE_PATHS: Record<Exclude<DesignAiScope, 'site'>, (path: string) => boolean> = {
  brand: (path) => path === 'mode' || path.startsWith('brand.') || path.startsWith('shape.'),
  header: (path) => path === 'layout.header' || path === 'layout.nav',
  band: (path) => path === 'layout.band' || path.startsWith('pages.feedback.headline.'),
  welcome: (path) => path === 'pages.feedback.welcome.show',
  feed: (path) => ['layout.cards', 'layout.density', 'pages.feedback.defaultSort'].includes(path),
  filters: (path) => path === 'layout.filters',
}

/** A value at one design path; null is an optional colour left to be derived. */
export type DesignValue = string | number | boolean | null

export interface DesignChangeRequest {
  path: string
  value: DesignValue
}

export interface AppliedDesignChange {
  path: string
  before: DesignValue
  after: DesignValue
}

/** The headline text in English, which other languages fall back to. */
const HEADLINE_LOCALE = 'en'

function read(doc: PortalDesign, path: string): DesignValue {
  if (path.startsWith('brand.fonts.') && path !== 'brand.fonts.headingWeight') {
    const font = doc.brand.fonts[path.endsWith('heading') ? 'heading' : 'body']
    return font.kind === 'bundled' ? font.id : font.family
  }
  if (path.startsWith('pages.feedback.headline.')) {
    const field = path.endsWith('title') ? 'title' : 'subtitle'
    return doc.pages.feedback.headline?.[field][HEADLINE_LOCALE] ?? null
  }
  const value = path
    .split('.')
    .reduce<unknown>((object, key) => (object as Record<string, unknown>)?.[key], doc)
  return (value ?? null) as DesignValue
}

/** The draft with one change written in, or null when the value cannot go there. */
function write(doc: PortalDesign, path: string, value: unknown): PortalDesign | null {
  const next = structuredClone(doc) as PortalDesign
  if (path.startsWith('brand.light.') || path.startsWith('brand.dark.')) {
    const [, mode, key] = path.split('.') as [string, 'light' | 'dark', string]
    if (mode === 'dark') next.brand.dark = { ...next.brand.dark }
    const palette = next.brand[mode] as Record<string, string | undefined>
    if (value === null || value === undefined) {
      // Only an optional colour can be cleared; the schema refuses the rest.
      delete palette[key]
      return next
    }
    const colour = typeof value === 'string' ? normaliseColor(value) : null
    if (!colour) return null
    palette[key] = colour
    return next
  }
  if (path === 'brand.fonts.heading' || path === 'brand.fonts.body') {
    if (!(BUNDLED_FONT_IDS as readonly unknown[]).includes(value)) return null
    next.brand.fonts[path.endsWith('heading') ? 'heading' : 'body'] = {
      kind: 'bundled',
      id: value as (typeof BUNDLED_FONT_IDS)[number],
    }
    return next
  }
  if (path.startsWith('pages.feedback.headline.')) {
    if (typeof value !== 'string') return null
    const field = path.endsWith('title') ? 'title' : 'subtitle'
    const headline = next.pages.feedback.headline ?? { title: {}, subtitle: {} }
    if (value.trim()) headline[field][HEADLINE_LOCALE] = value.trim()
    else delete headline[field][HEADLINE_LOCALE]
    const empty = !Object.keys(headline.title).length && !Object.keys(headline.subtitle).length
    next.pages.feedback.headline = empty ? null : headline
    return next
  }
  const keys = path.split('.')
  const last = keys.pop()!
  const parent = keys.reduce<Record<string, unknown>>(
    (object, key) => object[key] as Record<string, unknown>,
    next as unknown as Record<string, unknown>
  )
  parent[last] = value
  return next
}

const isValid = (doc: PortalDesign) => {
  const parsed = portalDesign.safeParse(doc)
  return parsed.success && resolveDesign(parsed.data).errors.length === 0
}

export function applyDesignChanges(
  doc: PortalDesign,
  changes: DesignChangeRequest[],
  scope: DesignAiScope
): { design: PortalDesign; applied: AppliedDesignChange[]; skipped: number } {
  let design = doc
  const applied: AppliedDesignChange[] = []
  let skipped = 0
  for (const { path, value } of changes) {
    const offered = (DESIGN_AI_PATHS as readonly string[]).includes(path)
    const inScope = scope === 'site' || SCOPE_PATHS[scope](path)
    const next = offered && inScope ? write(design, path, value) : null
    if (!next || !isValid(next)) {
      skipped++
      continue
    }
    const before = read(design, path)
    const after = read(next, path)
    if (before === after) continue
    applied.push({ path, before, after })
    design = portalDesign.parse(next)
  }
  return { design, applied, skipped }
}
