/**
 * A brand matched from its website alone, when no screenshot of it can be
 * had (captures are not set up, used up, or the site walls off headless
 * browsers): the whole look from the site's colours and name, as the model
 * knows the brand, then what the site's code names set exactly: its logo
 * file, favicon, share picture and fonts. The reply offers a screenshot for
 * the look, which only pixels can settle.
 */
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { logger } from '@/lib/server/logger'
import type { DesignAiResult } from './design-ai'
import type { BrandChange } from './brand-decide'
import type { BrandMatchInput, BrandMatchResult } from './brand-match'
import { siteNotes, storeSiteAssets, type SiteAssetStore, type SiteUse } from './brand-site-use'
import {
  siteAssetChanges,
  siteFontChanges,
  siteFontPlan,
  siteLogoBytes,
  siteName,
  svgAspect,
} from './brand-site'
import type { SiteAsset, SiteRead } from '../site/types'

const log = logger.child({ module: 'brand-site-match' })

/** A logo wider than this (over its height) is a full logo, the name in it; narrower, an icon. */
const WORDMARK_FROM = 2.2

/** The ask a match without a screenshot ends with. */
export const ADD_SCREENSHOT = 'Paste a screenshot of your site and I will match its look too.'

function aspectOf(asset: SiteAsset): number {
  if (asset.mime === 'image/svg+xml') return svgAspect(new TextDecoder().decode(asset.bytes)) ?? 1
  return asset.width / Math.max(1, asset.height)
}

/** Whether a logo file is wide enough to be a full logo, the name in it. */
export function isFullLogo(asset: SiteAsset): boolean {
  return aspectOf(asset) >= WORDMARK_FROM
}

/** The logo's changes: a full logo or an icon beside the name, by its shape. */
export function siteLogoChanges(key: string, asset: SiteAsset, name: string | null): BrandChange[] {
  const why =
    asset.from === 'header-svg' || asset.from === 'header-img'
      ? 'the logo in your site’s header'
      : 'the logo your site names as its own'
  if (isFullLogo(asset))
    return [
      { path: 'brand.logo.wordmark.light', value: { key }, why },
      { path: 'brand.logo.display', value: 'wordmark', why: 'the logo shows the name itself' },
    ]
  return [
    { path: 'brand.logo.mark.light', value: { key }, why },
    { path: 'brand.logo.display', value: 'mark_and_name', why: 'a symbol, shown beside the name' },
    ...(name
      ? [{ path: 'brand.logo.name', value: name, why: 'the name your site gives itself' }]
      : []),
  ]
}

export async function siteOnlyMatch(
  input: Pick<BrandMatchInput, 'design' | 'allows'> & {
    site: SiteRead & { facts: NonNullable<SiteRead['facts']> }
  },
  deps: { fallback: () => Promise<DesignAiResult>; storeAsset?: SiteAssetStore },
  /** Why there is no screenshot, said first. */
  because: string | null
): Promise<DesignAiResult | BrandMatchResult> {
  const { site } = input
  const look = await deps.fallback()
  const base: PortalDesign = look.ok ? look.design : input.design
  const plan = siteFontPlan(site.facts)
  const name = siteName(site.facts)
  // A logo the site names in its header or its structured data; a social banner never.
  const logoAsset = site.logo && site.logo.from !== 'og-image' ? site.logo : null
  let logoKey: string | null = null
  if (logoAsset && deps.storeAsset) {
    const bytes = siteLogoBytes(logoAsset, null)
    try {
      logoKey = bytes ? await deps.storeAsset(bytes, logoAsset.mime, 'logo') : null
    } catch (err) {
      log.warn({ err }, 'could not store the site logo')
    }
  }
  const keys = deps.storeAsset
    ? await storeSiteAssets(site, input.design, deps.storeAsset)
    : { favicon: null, shareImage: null }
  const changes: BrandChange[] = [
    ...siteFontChanges(plan, base, { heading: false, body: false }),
    ...(logoKey && logoAsset ? siteLogoChanges(logoKey, logoAsset, name) : []),
    ...siteAssetChanges(input.design, keys),
  ]
  const applied = applyDesignChanges(
    base,
    changes.map(({ path, value }) => ({ path, value })),
    'site',
    {
      ...input.allows,
      links: new Set(),
      files: new Set([logoKey, keys.favicon, keys.shareImage].filter((k): k is string => !!k)),
    }
  )
  const why = new Map(changes.map((c) => [c.path, c.why]))
  const host = (() => {
    try {
      return new URL(site.facts.url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  const use: SiteUse = {
    host,
    favicon: applied.applied.some((c) => c.path === 'brand.favicon'),
    shareImage: applied.applied.some((c) => c.path === 'brand.shareImage'),
    logo: logoKey ? 'site' : null,
    logoWhy: null,
    fonts: plan,
    snapped: [],
    name,
  }
  // The other looks came with the first, at no further cost; each keeps what the site set.
  const siteSet = new Set(applied.applied.map((c) => c.path))
  const others = look.ok
    ? look.others?.map((other) => ({
        description: other.description,
        changes: [...other.changes.filter((c) => !siteSet.has(c.path)), ...applied.applied],
      }))
    : undefined
  const lead = look.ok
    ? look.reply.replace(/ from your screenshots?\./, ` from ${host}.`)
    : `I read ${host}.`
  return {
    ok: true,
    reply: [because, lead].filter(Boolean).join(' '),
    design: applied.design,
    applied: [
      ...(look.ok
        ? look.applied.filter((c) => !applied.applied.some((a) => a.path === c.path))
        : []),
      ...applied.applied.map((c) => ({ ...c, why: why.get(c.path) })),
    ],
    skipped: applied.skipped,
    outOfScope: false,
    readability: [],
    asks: [ADD_SCREENSHOT],
    notes: siteNotes(use),
    chips: [],
    logo: null,
    timings: {},
    target: null,
    site: use,
    ...(others?.length && { others }),
  }
}
