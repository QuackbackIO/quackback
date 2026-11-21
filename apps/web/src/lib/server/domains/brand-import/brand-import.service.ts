/**
 * Import your brand: read a website and turn what it says into the portal
 * editor's draft values. Nothing is saved: the logo is uploaded and its key
 * returned, and only a publish (`logo.wideKey`) puts it in the settings.
 *
 * Order matters, and is pinned by tests: the address is checked offline
 * first (a public website on a standard port, nothing local); then the import
 * is counted against the workspace's limits; then robots.txt is read and
 * honoured; only then is the homepage read. Every fetch goes through the
 * SSRF guard (site/site-read.ts `liveSiteFetcher`). Font files are never
 * fetched by the app: the browser reader hands back the ones the page's text
 * is set in, and those that may be copied (site/site-font.ts) are uploaded
 * like the logo, saved to no setting until a publish names them.
 */
import { logger } from '@/lib/server/logger'
import { incrementBuckets } from '@/lib/server/utils/rate-bucket'
import { generateStorageKey, isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { sanitizeSvg } from '@/lib/server/content/svg-sanitize'
import {
  ForbiddenError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from '@/lib/shared/errors'
import {
  mapBrandRead,
  sameFontFamily,
  type BrandDraft,
  type BrandImport,
  type BrandImportMissing,
  type BrandRead,
} from '@/lib/shared/theme/brand-import'
import { FONT_FAMILY_NAME, FONT_FORMATS, FONT_UPLOADS } from '@/lib/shared/theme/font-uploads'
import { siteDarkLogo } from './logo-dark'
import { contrast, inksOfMarkup, legibleLogo } from './logo-legible'
import { mergeBrandReads, type BrandReader } from './readers'
import { portalOnSite } from '@/lib/server/domains/settings/portal-domain'
import { robotsAllows } from './robots'
import { MIN_ICON_PX } from './site/app-icon'
import { siteHost } from './site/host'
import { brandName } from './site/site-name'
import { localVersion } from './site/local-version'
import { logoShowsOn } from './site/logo-ink'
import { liveSiteFetcher } from './site/site-read'
import type { SiteFetcher } from './site/types'
import { brandLike, pickerAddresses, SiteNotReadError } from './site-not-read'
import { staticBrandReader } from './static-reader'

export { legibleLogo } from './logo-legible'
export { SiteNotReadError, type SiteNotReadReason } from './site-not-read'

const log = logger.child({ component: 'brand-import' })

/** Imports per workspace: a few in a row while trying addresses, and a daily ceiling. */
const LIMITS = [
  { key: 'brand-import:minute', windowSeconds: 60, max: 5 },
  { key: 'brand-import:day', windowSeconds: 86_400, max: 30 },
] as const

const LIGHT_INK = '#0a0a0a'
/** The contrast a logo's ink needs with the page to be drawn in it. */
const READABLE_INK = 4.5
const DARK_INK = '#fafafa'
const ROBOTS_MAX_BYTES = 64 * 1024
const ROBOTS_TIMEOUT_MS = 5_000

const EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  ...Object.fromEntries(Object.entries(FONT_FORMATS).map(([ext, format]) => [format.type, ext])),
}

export interface ImportBrandOptions {
  /** How the static reader fetches; the live, SSRF-guarded web by default. */
  fetcher?: SiteFetcher
  /** A reader that measures the rendered page, when one is deployed. */
  browser?: BrandReader
  /** The admin's languages, most wanted first (lowercased tags), for a country picker homepage. */
  languages?: string[]
  /** Whether the caller may change the square logo (settings.manage); a wide one needs only branding. */
  canStageSquareLogo?: boolean
  /** The hosts the portal is served on (portal-domain.ts), for the brand assets' first answer. */
  portalHosts?: readonly string[]
}

async function enforceLimits(): Promise<void> {
  // Store errors come back as null counts and let the import through.
  const counts = await incrementBuckets(
    LIMITS.map(({ key, windowSeconds }) => ({ key, windowSeconds }))
  )
  const over = LIMITS.find((limit, i) => (counts[i] ?? 0) > limit.max)
  if (over) {
    log.warn({ limit: over.key }, 'brand import rate limited')
    throw new RateLimitError(over.windowSeconds)
  }
}

/** Whether robots.txt lets the reader read the page at `url`. */
async function robotsAllowPath(url: string, fetcher: SiteFetcher): Promise<boolean> {
  const res = await fetcher(new URL('/robots.txt', url).href, 'robots', {
    maxBytes: ROBOTS_MAX_BYTES,
    timeoutMs: ROBOTS_TIMEOUT_MS,
  })
  if (!res || res.status < 200 || res.status >= 300) return true
  if (!res.contentType.toLowerCase().startsWith('text/plain')) return true
  return robotsAllows(new TextDecoder().decode(res.body), new URL(url).pathname)
}

/** Whether robots.txt lets the reader read the homepage. A missing or unreadable file allows it. */
async function robotsAllowHome(siteUrl: string, fetcher: SiteFetcher): Promise<boolean> {
  const res = await fetcher(new URL('/robots.txt', siteUrl).href, 'robots', {
    maxBytes: ROBOTS_MAX_BYTES,
    timeoutMs: ROBOTS_TIMEOUT_MS,
  })
  if (!res || res.status < 200 || res.status >= 300) return true
  if (!res.contentType.toLowerCase().startsWith('text/plain')) return true
  return robotsAllows(new TextDecoder().decode(res.body), '/')
}

/**
 * Uploads `bytes` under `prefix`, recorded as staged first, or null when it
 * cannot be stored. A brand asset (the logo, the icon, a commercial font) is
 * recorded as one, so a publish puts it live only with a confirmation.
 */
async function stageObject(
  prefix: string,
  bytes: Uint8Array,
  mime: string,
  brandAsset = true
): Promise<{ stagedKey: string; url: string } | null> {
  const extension = EXTENSIONS[mime]
  if (!extension || !isS3Usable()) return null
  try {
    const stagedKey = generateStorageKey(prefix, `staged-import.${extension}`)
    // Recorded first: a publish accepts only a staged key, and the daily
    // sweep removes it if nothing ever names it.
    const { recordStagedUpload } =
      await import('@/lib/server/domains/settings/settings.staged-uploads')
    await recordStagedUpload(stagedKey, { brandAsset })
    const url = await uploadObject(stagedKey, bytes, mime)
    return { stagedKey, url }
  } catch (err) {
    log.error({ err, prefix }, 'staging an imported file failed')
    return null
  }
}

/**
 * Uploads the logo (the site's header artwork, any shape) for the header
 * slot, which serves SVG. Markup the sanitiser refuses, or a logo that would
 * not show on the page, is never stored. Whether it shows is read from the
 * inks the browser reader drew it in when it did, else from its markup's paints.
 */
async function stageLogo(
  logo: NonNullable<BrandRead['logo']>,
  ink: string,
  background: string
): Promise<{ stagedKey: string; url: string } | null> {
  // An <img> cannot inherit a text colour, so currentColor would draw black.
  const clean = logo.svg ? sanitizeSvg(logo.svg, { currentColor: ink }) : undefined
  if (clean === null) return null
  const svg = clean === undefined ? undefined : legibleLogo(clean, background, ink)
  if (svg === null) return null
  // As the reader drew it: a logo whose main ink vanishes into the bar does
  // not show, though a smaller colour in it does. One redrawn above now does.
  const inks = clean ? inksOfMarkup(logo.inks, clean) : logo.inks
  const vanishes = logoShowsOn(inks, background) === false
  if (vanishes && (svg === undefined || svg === clean)) {
    log.info({ kind: svg ? 'svg' : 'image' }, 'brand import left out a logo that would not show')
    return null
  }
  if (svg) return stageObject('header-logos', new TextEncoder().encode(svg), 'image/svg+xml')
  return logo.raster ? stageObject('header-logos', logo.raster.bytes, logo.raster.mime) : null
}

/** The portal's own dark page, for a site with no dark mode of its own. */
const DARK_SURFACE = '#0a0a0a'

/**
 * Uploads the site's own dark-mode logo as it is: its markup (sanitised by
 * the reader) or its bytes. It is never redrawn.
 */
async function stageDarkLogo(
  logo: NonNullable<BrandRead['darkLogo']>
): Promise<{ stagedKey: string; url: string } | null> {
  if (logo.svg !== undefined)
    return stageObject('header-logos', new TextEncoder().encode(logo.svg), 'image/svg+xml')
  return logo.raster ? stageObject('header-logos', logo.raster.bytes, logo.raster.mime) : null
}

/** A square header mark drawn as an image, large enough to stand as the icon. */
function iconFromLogo(logo: BrandRead['logo']): BrandRead['icon'] {
  if (!logo?.raster || logo.heightPx <= 0) return undefined
  const ratio = logo.widthPx / logo.heightPx
  if (ratio < 0.95 || ratio > 1.05 || logo.heightPx < MIN_ICON_PX) return undefined
  return { raster: logo.raster, widthPx: logo.widthPx, heightPx: logo.heightPx }
}

/**
 * Uploads the icon, and a copy as the favicon (a separate object: removing
 * one must never take the other), or null when either cannot be stored.
 */
async function stageIcon(
  icon: NonNullable<BrandRead['icon']>
): Promise<{ key: string; faviconKey: string; url: string } | null> {
  const main = await stageObject('logos', icon.raster.bytes, icon.raster.mime)
  if (!main) return null
  const favicon = await stageObject('favicons', icon.raster.bytes, icon.raster.mime)
  return favicon ? { key: main.stagedKey, faviconKey: favicon.stagedKey, url: main.url } : null
}

/**
 * The site's own font for the draft: its files uploaded under `fonts/`, or
 * why they were not copied. Nothing when the portal has the same font, when
 * the files are some other family's than the one the draft names, or when
 * the regular cannot be stored (the nearest listed font then stands alone).
 */
async function stageSiteFont(
  font: NonNullable<BrandRead['siteFont']>,
  draft: BrandDraft
): Promise<BrandImport['siteFont']> {
  const family = draft.font.site
  if (!family || draft.font.exact || draft.missing.includes('font')) return undefined
  return stageFontFiles(font, family)
}

/**
 * The site's headings font, likewise: only when its headings are set in a
 * family of their own that the portal does not have.
 */
async function stageSiteHeadingFont(
  font: NonNullable<BrandRead['siteHeadingFont']>,
  draft: BrandDraft
): Promise<BrandImport['siteHeadingFont']> {
  if (!draft.headings || draft.headings.id) return undefined
  return stageFontFiles(font, draft.headings.site)
}

/** `font`'s files staged as the family the draft names, when they are that family's. */
async function stageFontFiles(
  font: NonNullable<BrandRead['siteFont']>,
  family: string
): Promise<BrandImport['siteFont']> {
  if (!sameFontFamily(font.family, family)) return undefined
  if (family.length > 64 || !FONT_FAMILY_NAME.test(family)) return undefined
  if ('notCopied' in font) return { family, notCopied: font.notCopied }
  const files = []
  for (const file of font.files) {
    const staged = await stageObject(
      FONT_UPLOADS.prefix,
      file.bytes,
      FONT_FORMATS[file.format].type,
      // An open-licence font needs no confirmation; a commercial one does.
      font.licence === 'commercial'
    )
    // Without the first file (the regular, or a heading's semibold) there is no family to show.
    if (!staged && files.length === 0) return undefined
    if (!staged) continue
    files.push({
      key: staged.stagedKey,
      weight: file.weight,
      ...(file.weightTo !== undefined ? { weightTo: file.weightTo } : {}),
      style: 'normal' as const,
    })
  }
  return files.length > 0 ? { family, licence: font.licence, files } : undefined
}

const fontOutcome = (font: BrandImport['siteFont']) =>
  font ? ('notCopied' in font ? font.notCopied : font.licence) : null

/** The longest a site's name may be to stand in the portal's header (its own limit). */
const MAX_SITE_NAME_CHARS = 100

/**
 * The name the site goes by: the first of what it declares (`og:site_name`,
 * its organisation's, its app's, its logo's label) and its title that spells
 * its own domain, else the domain's own word (site/site-name.ts). Left out
 * when the site said nothing, or nothing short enough to be a header's name.
 */
export function siteNameOf(
  read: Pick<BrandRead, 'siteName' | 'names' | 'title' | 'nameWritten'>,
  siteUrl: string
): string | undefined {
  const name = brandName([read.siteName, ...(read.names ?? []), read.title], siteUrl, {
    written: read.nameWritten,
  })
  return name && name.length <= MAX_SITE_NAME_CHARS ? name : undefined
}

/**
 * Reads `input` (a domain or URL) and returns the editor's draft values, with
 * the logo staged. Throws a typed error people can read when the address is
 * not a public website, the limit is reached, robots.txt refuses, or the site
 * cannot be read.
 */
export async function importBrand(
  input: string,
  opts: ImportBrandOptions = {}
): Promise<BrandImport> {
  const site = siteHost(input)
  if (!site) throw new ValidationError('INVALID_WEBSITE', 'Enter a website, like example.com.')
  const host = site.host

  await enforceLimits()

  const fetcher = opts.fetcher ?? liveSiteFetcher
  if (!(await robotsAllowHome(site.url, fetcher))) {
    log.info({ host }, 'brand import refused by robots.txt')
    throw new ForbiddenError('ROBOTS_DISALLOWED', `${host} asks robots not to read it.`)
  }

  const readBoth = (url: string) =>
    Promise.all([
      staticBrandReader(fetcher).read(url),
      opts.browser?.read(url).catch((err: unknown) => {
        log.warn({ err, host }, 'browser reader failed, using the static read')
        return null
      }),
    ])
  let [staticResult, browserResult] = await readBoth(site.url)
  // A country or language picker homepage: read the version the admin's own
  // browser would have been sent to, when robots.txt allows it.
  const versions =
    'read' in staticResult ? staticResult.read.localVersions : staticResult.localVersions
  const local = versions ? localVersion(versions, opts.languages ?? []) : null
  if (local && (await robotsAllowPath(local, fetcher))) {
    log.info({ host, local }, 'brand import reads a local version')
    const [localStatic, localBrowser] = await readBoth(local)
    if ('read' in localStatic || (localBrowser && 'read' in localBrowser))
      [staticResult, browserResult] = [localStatic, localBrowser]
  }
  const results = [staticResult, browserResult].filter((result) => result != null)
  const staticRead = 'read' in staticResult ? staticResult.read : null
  const browserRead = browserResult && 'read' in browserResult ? browserResult.read : null
  // Each reader that was shown something in the site's place, and what.
  const turnedAway = results.flatMap((result) =>
    'failed' in result && result.failed !== 'unreachable' ? [result] : []
  )
  const lone = browserRead ?? staticRead
  // One reader was turned away and the other read nothing of the brand (an
  // app's empty shell): there is nothing to import, and the person is told why.
  const thin =
    lone !== null && !(browserRead && staticRead) && turnedAway.length > 0 && !brandLike(lone)
  if (!lone || thin) {
    const refusal = (['picker', 'challenge', 'error'] as const)
      .map((failed) => turnedAway.find((result) => result.failed === failed))
      .find((result) => result !== undefined)
    if (refusal) {
      const reason = refusal.failed === 'challenge' ? 'bot' : (refusal.failed as 'picker' | 'error')
      const candidates =
        reason === 'picker' ? pickerAddresses(turnedAway, site.url, opts.languages ?? []) : []
      log.info(
        { host, reason, candidates: candidates.length },
        'brand import read no page of the site'
      )
      throw new SiteNotReadError(reason, host, candidates)
    }
    throw new ServiceUnavailableError(
      'SITE_UNREACHABLE',
      `We couldn't reach ${host}. Check the address or try again.`
    )
  }
  const read = browserRead ? mergeBrandReads(browserRead, staticRead ?? {}) : staticRead!

  const { logo: wanted, ...draft } = mapBrandRead(read)
  // Only a text colour that reads on the page: a hero's white words are not the page's.
  const pageText = read.page?.text
  // The logo sits on the header bar: the site's own bar when it has one, else the page.
  const background = draft.tokens?.header ?? draft.background ?? '#ffffff'
  const ink =
    pageText && contrast(pageText, background) >= READABLE_INK
      ? pageText
      : contrast(DARK_INK, background) > contrast(LIGHT_INK, background)
        ? DARK_INK
        : LIGHT_INK
  const logo = wanted && read.logo ? await stageLogo(read.logo, ink, background) : null
  // The site's own dark-mode logo, beside the logo it stands in for. Never for a
  // dark site, whose logo is already the one for dark; never one made by recolouring.
  const darkSurface = draft.darkMode?.header ?? draft.darkMode?.background ?? DARK_SURFACE
  const darkArt = logo && draft.scheme !== 'dark' ? siteDarkLogo(read, darkSurface) : null
  const logoDark = darkArt ? await stageDarkLogo(darkArt) : null
  // The icon: the site's app icon, else a square header mark drawn as an image.
  // Changing the workspace icon needs settings.manage.
  const iconArt = read.icon ?? iconFromLogo(read.logo)
  const iconBlocked = Boolean(iconArt) && !opts.canStageSquareLogo
  const icon = iconArt && !iconBlocked ? await stageIcon(iconArt) : null
  const siteFont = read.siteFont ? await stageSiteFont(read.siteFont, { ...draft }) : undefined
  const siteHeadingFont = read.siteHeadingFont
    ? await stageSiteHeadingFont(read.siteHeadingFont, { ...draft })
    : undefined
  const siteName = siteNameOf(read, site.url)
  const missing: BrandImportMissing[] = [
    ...(logo ? [] : ['logo' as const]),
    ...(icon || iconBlocked ? [] : ['icon' as const]),
    ...draft.missing.filter((item) => item !== 'logo'),
  ]

  log.info(
    {
      host,
      reader: browserRead ? 'browser' : 'static',
      missing,
      logo: logo ? wanted?.kind : null,
      logoDark: darkArt ? darkArt.how : null,
      icon: Boolean(icon),
      font: fontOutcome(siteFont),
      headings: draft.headings
        ? (draft.headings.id ?? fontOutcome(siteHeadingFont) ?? 'not-copied')
        : null,
      cards: draft.cardStyle ?? null,
      name: Boolean(siteName),
    },
    'brand imported'
  )
  return {
    ...draft,
    missing,
    host,
    reader: browserRead ? 'browser' : 'static',
    logo: logo && wanted ? { kind: wanted.kind, ...logo } : undefined,
    ...(logoDark ? { logoDark } : {}),
    icon: icon ?? undefined,
    iconBlocked: iconBlocked ? 'permission' : undefined,
    siteFont,
    siteHeadingFont,
    ...(siteName ? { siteName } : {}),
    portalOnSite: portalOnSite(host, opts.portalHosts ?? []),
  }
}
