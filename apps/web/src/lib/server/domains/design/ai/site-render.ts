/**
 * A website read as a browser renders it, from the website reader beside
 * Quackback when one is configured. Its values are what the page shows, so
 * they lead the read of the page's HTML and CSS wherever both have one. With
 * no reader, or none answering within the budget, nothing changes.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { contrastRatio } from '@/lib/shared/design/contrast'
import type {
  BrandMeasurements,
  MeasuredBox,
  MeasuredType,
} from '@/lib/shared/design/measured-tune'
import { isBrandColour } from '@/lib/shared/design/palette'
import type { PageBox, PageMeasure, PageType } from '../render/page-scripts'
import type { PageRead } from '../render/read-page'
import { hex } from './site-brand'
import type { SiteSignals } from './site-signals'

const log = logger.child({ module: 'site-render' })

// A heavy site can take half a minute to render; a design starts once, so it waits.
const BUDGET_MS = 40_000
/** A reader that sleeps between reads can refuse the first request while it wakes. */
const WAKE_MS = 1_500

export interface RenderedSite {
  measured: BrandMeasurements
  /** What the render says of the brand, where it can say it. */
  brand: Pick<SiteSignals, 'background' | 'dark' | 'button' | 'monochrome'> &
    Partial<Pick<SiteSignals, 'colour' | 'hero' | 'bold'>> & {
      fonts: { heading: string | null; body: string | null }
      /**
       * The first screen's main colours, as an uploaded screenshot's: by pixel
       * where the screenshot could be read, else by painted area, the main
       * button's first. Imagery and gradients are in the first, not the second.
       */
      palette: string[]
    }
  /** The first screen, as a JPEG data URL. */
  screenshot: string | null
  title: string | null
}

const fill = (colour: string) => {
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(colour)
  return alpha && Number(alpha[1]) < 0.9 ? null : hex(colour)
}

/** A family stack's first few names, which the font matcher reads in order. */
const stack = (family: string | undefined) =>
  family
    ? family
        .split(',')
        .slice(0, 3)
        .map((name) => name.trim())
        .join(', ')
    : null

function typeOf(t: PageType | null): MeasuredType | null {
  if (!t || !t.size) return null
  const colour = hex(t.colour)
  return {
    size: t.size,
    weight: t.weight,
    ...(Math.abs(t.tracking) >= 0.005 && { tracking: Math.round(t.tracking * 1000) / 1000 }),
    ...(Number.isFinite(t.leading) && { leading: Math.round(t.leading * 100) / 100 }),
    ...(colour && { colour }),
  }
}

function boxOf(b: PageBox | null, action = false): MeasuredBox | null {
  if (!b) return null
  const background = fill(b.fill)
  const ink = hex(b.ink)
  return {
    radius: b.radius >= 999 ? 999 : Math.round(b.radius),
    height: Math.round(b.height),
    borderWidth: b.borderWidth,
    shadow: b.shadow,
    ...(background && { fill: background }),
    ...(ink && { ink }),
    weight: b.weight,
    ...(b.transform === 'uppercase' && { upper: true }),
    ...(action && { action: true }),
  }
}

/** A rendered page's measurements and brand, in the terms the design steps read. */
export function fromPage(
  page: PageMeasure,
  shotPalette: string[] = []
): Omit<RenderedSite, 'screenshot'> {
  const background = fill(page.page) ?? '#ffffff'
  const button = page.button ? fill(page.button.fill) : null
  const hero = page.hero ? fill(page.hero) : null
  const brandHero = hero && hero !== background ? hero : null
  // The brand colour, only where the page says so: its main call to action's
  // fill, else a hero it fills edge to edge. A colour that merely covers an
  // area, such as a promotion's panel, is in the palette and no more.
  const strong = [page.action ? button : null, brandHero].find(
    (c): c is string => !!c && isBrandColour(c)
  )
  const painted = page.palette.flatMap(({ colour }) => fill(colour) ?? [])
  const palette = (shotPalette.length ? [strong, ...shotPalette] : [button, ...painted]).filter(
    (c, i, all): c is string => !!c && all.indexOf(c) === i
  )
  return {
    title: page.title || null,
    measured: {
      headline: typeOf(page.headline),
      heading: typeOf(page.heading),
      button: boxOf(page.button, page.action),
      card: boxOf(page.card),
      field: boxOf(page.field),
    },
    brand: {
      background,
      dark: contrastRatio('#ffffff', background) > contrastRatio('#000000', background),
      button,
      monochrome: !!button && !isBrandColour(button) && contrastRatio('#ffffff', button) > 7,
      ...(strong && { colour: strong }),
      ...(brandHero && { hero: brandHero, bold: isBrandColour(brandHero) }),
      fonts: { heading: stack(page.headline?.family), body: stack(page.body?.family) },
      palette: palette.slice(0, 6),
    },
  }
}

/** The site's signals with what the render shows leading what its CSS suggests. */
export function withRendered(site: SiteSignals, rendered: RenderedSite): SiteSignals {
  const { brand } = rendered
  // The site's own colours keep their order behind the colour the render is sure of.
  const vivid = brand.palette.filter(isBrandColour)
  const colour = brand.colour ?? site.colour ?? vivid[0] ?? null
  const palette = [colour, ...site.palette, ...vivid].filter(
    (c, i, all): c is string => !!c && all.indexOf(c) === i
  )
  return {
    ...site,
    title: site.title ?? rendered.title,
    background: brand.background,
    dark: brand.dark,
    button: brand.button ?? site.button,
    monochrome: brand.button ? brand.monochrome : site.monochrome,
    colour,
    hero: brand.hero ?? site.hero,
    bold: brand.bold ?? site.bold,
    fonts: {
      heading: brand.fonts.heading ?? site.fonts.heading,
      body: brand.fonts.body ?? site.fonts.body,
    },
    palette: palette.slice(0, 5),
    measured: { ...site.measured, ...withoutEmpty(rendered.measured) },
  }
}

/**
 * The colours the looks start from when the rendered screen stands in for a
 * screenshot: the site's brand colour first, then the screen's. A screen's
 * own leading colour can be a photo's.
 */
export function lookPalette(site: SiteSignals | null, rendered: RenderedSite): string[] {
  return [site?.colour, ...rendered.brand.palette]
    .filter((c, i, all): c is string => !!c && all.indexOf(c) === i)
    .slice(0, 6)
}

/** Signals from the render alone, when the page's HTML could not be read. */
export function renderedSignals(domain: string, rendered: RenderedSite): SiteSignals {
  const { brand } = rendered
  return withRendered(
    {
      domain,
      title: rendered.title,
      description: null,
      colour: null,
      palette: [],
      background: null,
      fonts: { heading: null, body: null },
      dark: false,
      button: null,
      bold: false,
      monochrome: false,
      hero: null,
      logo: null,
      shareImage: null,
      measured: null,
    },
    { ...rendered, brand: { ...brand } }
  )
}

function withoutEmpty(measured: BrandMeasurements): BrandMeasurements {
  return Object.fromEntries(
    Object.entries(measured).filter(([, value]) => value)
  ) as BrandMeasurements
}

/** The site as the reader renders it, or null without a reader or an answer in time. */
export async function renderSite(site: string, budgetMs = BUDGET_MS): Promise<RenderedSite | null> {
  const base = config.browserUrl
  const token = config.browserToken
  if (!base || !token) return null
  const deadline = Date.now() + budgetMs
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(new URL('/read', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: site }),
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    }).catch(() => null)
    if (response && (response.status === 502 || response.status === 503) && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, WAKE_MS))
      continue
    }
    if (!response?.ok) {
      log.warn({ status: response?.status ?? null }, 'website reader did not answer')
      return null
    }
    const read = (await response.json().catch(() => null)) as PageRead | null
    if (!read?.ok) {
      log.info({ reason: read?.reason ?? 'unreadable' }, 'website reader could not read the site')
      return null
    }
    return { ...fromPage(read.measure, read.shotPalette ?? []), screenshot: read.screenshot }
  }
  return null
}
