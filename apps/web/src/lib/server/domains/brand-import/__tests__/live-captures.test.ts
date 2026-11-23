/**
 * The static path on the real homepages of the measured sites, replayed
 * offline from captures recorded by capture-live-sites.ts (last on
 * 2026-11-18). The captures are other companies' pages and stay outside the
 * repository (live-captures-dir.ts), so this suite skips where they are
 * absent. No network: the snapshot fetcher refuses any URL it has no record
 * of.
 *
 * Expectations are what a browser measured (spec section 9) wherever the
 * page's HTML and the stylesheets it links can give it. Where they cannot
 * (the value lives in CSS only a script loads), the static path must leave
 * the value unset rather than guess, and the expectation says so.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapBrandRead, type BrandDraft } from '@/lib/shared/theme/brand-import'

vi.mock('@/lib/server/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: { child: () => log } }
})

const { LIVE_SITES, liveCapturesDir } = await import('./live-captures-dir')
const { readSite } = await import('../site/site-read')
const { snapshotFetcher } = await import('../site/site-snapshot')
const { brandReadFromSite } = await import('../static-reader')

type Expected = Pick<
  BrandDraft,
  'primary' | 'background' | 'scheme' | 'text' | 'radius' | 'buttonShape' | 'buttonPx'
> & {
  font: BrandDraft['font'] | null
  logo: 'wide' | 'square' | null
  /** The app icon's side in px, or null when the site has none large enough. */
  icon: number | null
}

const EXPECTED: Record<string, Expected> = {
  'stripe.com': {
    primary: '#533afd',
    background: '#ffffff',
    scheme: 'light',
    text: undefined,
    font: { site: 'Sohne', id: 'inter', exact: false },
    radius: 0.25,
    buttonShape: 'corners',
    buttonPx: 4,
    logo: 'wide',
    icon: 180,
  },
  'www.ikea.com': {
    // No button gives a colour; the logo file is drawn mostly in IKEA blue.
    primary: '#0058a3',
    background: '#fffefb',
    scheme: 'light',
    text: undefined,
    font: { site: 'Noto IKEA', id: 'roboto', exact: false },
    radius: 0.5,
    buttonShape: 'pill',
    buttonPx: undefined,
    logo: 'wide',
    icon: null,
  },
  'linear.app': {
    // The page's theme, fonts and buttons are in stylesheets only a script
    // loads. The page says it is dark and names its theme colour, which is
    // its background; a main colour, font and shape need a browser.
    primary: undefined,
    background: '#08090a',
    scheme: 'dark',
    text: undefined,
    font: null,
    radius: undefined,
    buttonShape: undefined,
    buttonPx: undefined,
    // Its header is built by a script: no logo without a browser.
    logo: null,
    icon: null,
  },
  'notion.com': {
    primary: '#0075de',
    background: '#ffffff',
    scheme: 'light',
    text: undefined,
    font: { site: 'Notion Inter', id: 'inter', exact: false },
    radius: 0.5,
    buttonShape: 'corners',
    buttonPx: 8,
    logo: 'square',
    icon: 512,
  },
}

async function staticDraft(host: string): Promise<BrandDraft & { iconPx: number | null }> {
  const dir = join(liveCapturesDir(), host)
  const site = await readSite(`https://${host}/`, snapshotFetcher(dir, { strict: true }), {
    now: () => 0,
  })
  expect(site.failed).toBeNull()
  const read = brandReadFromSite(site)
  return { ...mapBrandRead(read), iconPx: read.icon?.widthPx ?? null }
}

const captured = LIVE_SITES.every((host) =>
  existsSync(join(liveCapturesDir(), host, 'manifest.json'))
)

describe.skipIf(!captured)(
  `the static path on the captured homepages (skipped without captures in ${liveCapturesDir()}; run capture-live-sites.ts)`,
  () => {
    it.each(Object.keys(EXPECTED))('%s', async (host) => {
      const draft = await staticDraft(host)
      expect({
        primary: draft.primary,
        background: draft.background,
        scheme: draft.scheme,
        text: draft.text,
        font: draft.missing.includes('font') ? null : draft.font,
        radius: draft.radius,
        buttonShape: draft.buttonShape,
        buttonPx: draft.buttonPx,
        logo: draft.logo?.kind ?? null,
        icon: draft.iconPx,
      }).toEqual(EXPECTED[host])
    })
  }
)
