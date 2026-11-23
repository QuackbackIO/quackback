/**
 * Import your brand, end to end over a fake web: the address is checked
 * before anything is fetched or counted, robots.txt is honoured, the rate
 * limit holds, and the logo is uploaded but saved to no setting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pngOf } from '@/lib/server/content/__tests__/image-fixtures'
import type { FetchedBody, SiteFetcher, SiteFetchKind } from '../site/types'
import { woff2 } from '../site/__tests__/font-fixture'

const seams = vi.hoisted(() => ({
  counts: [1, 1] as Array<number | null>,
  buckets: [] as Array<{ key: string; windowSeconds: number }>,
  usable: true,
  uploads: [] as Array<{ key: string; body: string; contentType: string }>,
  uploadFails: false,
  /** Uploads under this prefix fail. */
  failPrefix: null as string | null,
  staged: [] as string[],
}))

vi.mock('@/lib/server/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: { child: () => log } }
})
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBuckets: vi.fn(async (specs: Array<{ key: string; windowSeconds: number }>) => {
    seams.buckets.push(...specs)
    return seams.counts
  }),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => seams.usable,
  generateStorageKey: (prefix: string, filename: string) => `${prefix}/2026/11/uuid-${filename}`,
  uploadObject: vi.fn(async (key: string, body: Uint8Array, contentType: string) => {
    if (seams.uploadFails || (seams.failPrefix && key.startsWith(seams.failPrefix)))
      throw new Error('storage down')
    seams.uploads.push({ key, body: new TextDecoder().decode(body), contentType })
    return `https://cdn.example/${key}`
  }),
}))

vi.mock('@/lib/server/domains/settings/settings.staged-uploads', () => ({
  recordStagedUpload: vi.fn(async (key: string) => {
    seams.staged.push(key)
  }),
}))

const { importBrand, SiteNotReadError, siteNameOf } = await import('../brand-import.service')

const enc = (s: string) => new TextEncoder().encode(s)
const ok = (body: string, contentType: string): FetchedBody => ({
  status: 200,
  url: '',
  contentType,
  body: enc(body),
})

const WORDMARK =
  '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#1f4d3a" onclick="steal()"/><script>steal()</script></svg>'
const HOME = `<!doctype html><html><head>
  <title>Acme Parcel</title>
  <meta name="theme-color" content="#1f4d3a">
  <link rel="stylesheet" href="/main.css">
</head><body><header><a href="/">${WORDMARK}</a></header><h1>Parcels</h1></body></html>`
const CSS = 'body{font-family:"Acme Sans",Roboto,sans-serif} .btn{background:#c2410c}'

function fakeWeb(routes: Record<string, FetchedBody | null>) {
  const calls: Array<{ url: string; kind: SiteFetchKind }> = []
  const fetcher: SiteFetcher = async (url, kind) => {
    calls.push({ url, kind })
    const res = routes[url]
    return res ? { ...res, url: res.url || url } : null
  }
  return { fetcher, calls }
}

const SITE = {
  'https://acme.example/robots.txt': ok('User-agent: *\nDisallow: /admin\n', 'text/plain'),
  'https://acme.example/': ok(HOME, 'text/html'),
  'https://acme.example/main.css': ok(CSS, 'text/css'),
}

beforeEach(() => {
  seams.counts = [1, 1]
  seams.buckets.length = 0
  seams.usable = true
  seams.uploads.length = 0
  seams.staged.length = 0
  seams.uploadFails = false
  seams.failPrefix = null
})

describe('importBrand', () => {
  it('reads the site into draft values and stages its wordmark as a wide logo', async () => {
    const { fetcher } = fakeWeb(SITE)
    const result = await importBrand('https://acme.example/pricing?ref=x', { fetcher })

    expect(result).toMatchObject({
      host: 'acme.example',
      reader: 'static',
      primary: '#1f4d3a',
      font: { site: 'Acme Sans', id: 'roboto', exact: false },
      logo: {
        kind: 'wide',
        stagedKey: 'header-logos/2026/11/uuid-staged-import.svg',
        url: 'https://cdn.example/header-logos/2026/11/uuid-staged-import.svg',
      },
    })
    // The stylesheet styles the body but names no background: a transparent (white) page.
    expect(result).toMatchObject({ background: '#ffffff', scheme: 'light' })
    // The page names no app icon.
    expect(result.missing).toEqual(['icon', 'shape'])
    expect(seams.uploads).toHaveLength(1)
    expect(seams.uploads[0].contentType).toBe('image/svg+xml')
    expect(seams.uploads[0].body).not.toMatch(/script|onclick|steal/)
    // Recorded as staged, so a publish accepts it and the sweep can remove it.
    expect(seams.staged).toEqual([seams.uploads[0].key])
  })

  it.each([
    ['nothing', ''],
    ['a local name', 'localhost'],
    ['an address', '10.0.0.1'],
    ['an internal name', 'intranet.internal'],
    ['another scheme', 'ftp://acme.example'],
    ['another port', 'https://acme.example:8443'],
    ['credentials', 'https://user:pass@acme.example'],
  ])('refuses %s before fetching or counting anything', async (_label, input) => {
    const { fetcher, calls } = fakeWeb(SITE)
    await expect(importBrand(input, { fetcher })).rejects.toMatchObject({
      code: 'INVALID_WEBSITE',
      message: 'Enter a website, like example.com.',
    })
    expect(calls).toEqual([])
    expect(seams.buckets).toEqual([])
  })

  it('refuses a site whose robots.txt asks not to be read, fetching nothing else', async () => {
    const { fetcher, calls } = fakeWeb({
      ...SITE,
      'https://acme.example/robots.txt': ok(
        'User-agent: *\nDisallow: /\n',
        'text/plain; charset=utf-8'
      ),
    })
    await expect(importBrand('acme.example', { fetcher })).rejects.toMatchObject({
      code: 'ROBOTS_DISALLOWED',
      message: 'acme.example asks robots not to read it.',
    })
    expect(calls).toEqual([{ url: 'https://acme.example/robots.txt', kind: 'robots' }])
    expect(seams.uploads).toEqual([])
  })

  it('reads a site with no robots.txt, or one that is not text', async () => {
    const missing = fakeWeb({ ...SITE, 'https://acme.example/robots.txt': null })
    await expect(importBrand('acme.example', { fetcher: missing.fetcher })).resolves.toMatchObject({
      primary: '#1f4d3a',
    })
    const html = fakeWeb({
      ...SITE,
      'https://acme.example/robots.txt': ok('<html>Disallow: /</html>', 'text/html'),
    })
    await expect(importBrand('acme.example', { fetcher: html.fetcher })).resolves.toMatchObject({
      primary: '#1f4d3a',
    })
  })

  it('says when the site cannot be reached', async () => {
    const { fetcher } = fakeWeb({ 'https://acme.example/robots.txt': null })
    await expect(importBrand('acme.example', { fetcher })).rejects.toMatchObject({
      code: 'SITE_UNREACHABLE',
      message: "We couldn't reach acme.example. Check the address or try again.",
    })
  })

  it('counts every import against the minute and day limits of the workspace', async () => {
    const { fetcher } = fakeWeb(SITE)
    await importBrand('acme.example', { fetcher })
    expect(seams.buckets).toEqual([
      { key: 'brand-import:minute', windowSeconds: 60 },
      { key: 'brand-import:day', windowSeconds: 86_400 },
    ])
  })

  it.each([
    ['the minute', [6, 6]],
    ['the day', [1, 31]],
  ])('refuses an import over %s limit without fetching', async (_label, counts) => {
    seams.counts = counts
    const { fetcher, calls } = fakeWeb(SITE)
    await expect(importBrand('acme.example', { fetcher })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
    expect(calls).toEqual([])
  })

  it('lets an import through when the limit store is down', async () => {
    seams.counts = [null, null]
    const { fetcher } = fakeWeb(SITE)
    await expect(importBrand('acme.example', { fetcher })).resolves.toMatchObject({
      host: 'acme.example',
    })
  })

  it.each([
    ['storage is not set up', () => (seams.usable = false)],
    ['the upload fails', () => (seams.uploadFails = true)],
  ])('still gives colours and font when %s, with the logo missing', async (_label, arrange) => {
    arrange()
    const { fetcher } = fakeWeb(SITE)
    const result = await importBrand('acme.example', { fetcher })
    expect(result.logo).toBeUndefined()
    expect(result.missing).toEqual(['logo', 'icon', 'shape'])
    expect(result.primary).toBe('#1f4d3a')
  })

  describe('the logo and the icon', () => {
    const png = (side: number) => ({
      status: 200,
      url: '',
      contentType: 'image/png',
      body: pngOf(side, side),
    })

    it('stages the site’s app icon, with a favicon copy, beside its logo', async () => {
      const page = HOME.replace('<title>', '<link rel="apple-touch-icon" href="/touch.png"><title>')
      const routes = {
        ...SITE,
        'https://acme.example/': ok(page, 'text/html'),
        'https://acme.example/touch.png': png(180),
      }
      const owner = await importBrand('acme.example', {
        fetcher: fakeWeb(routes).fetcher,
        canStageSquareLogo: true,
      })
      expect(owner.logo).toMatchObject({
        kind: 'wide',
        stagedKey: expect.stringMatching(/^header-logos\//),
      })
      expect(owner.icon).toEqual({
        key: 'logos/2026/11/uuid-staged-import.png',
        faviconKey: 'favicons/2026/11/uuid-staged-import.png',
        url: 'https://cdn.example/logos/2026/11/uuid-staged-import.png',
      })
      expect(owner.missing).not.toContain('icon')
      // Each recorded as staged, so a publish accepts them and the sweep removes them otherwise.
      expect(seams.staged).toEqual(
        expect.arrayContaining([owner.icon!.key, owner.icon!.faviconKey])
      )
    })

    it('leaves the icon to an owner: someone with branding alone gets the logo only', async () => {
      const page = HOME.replace('<title>', '<link rel="apple-touch-icon" href="/touch.png"><title>')
      const routes = {
        ...SITE,
        'https://acme.example/': ok(page, 'text/html'),
        'https://acme.example/touch.png': png(180),
      }
      const branding = await importBrand('acme.example', { fetcher: fakeWeb(routes).fetcher })
      expect(branding.logo?.kind).toBe('wide')
      expect(branding.icon).toBeUndefined()
      expect(branding.iconBlocked).toBe('permission')
      expect(branding.missing).not.toContain('icon')
      expect(seams.uploads.map((upload) => upload.key)).toEqual([branding.logo!.stagedKey])
    })

    it('takes a square header mark drawn as an image as the logo, and as the icon', async () => {
      const page = HOME.replace(
        `<a href="/">${WORDMARK}</a>`,
        '<a href="/"><img src="/mark.png" alt="Acme"></a>'
      )
      const routes = {
        ...SITE,
        'https://acme.example/': ok(page, 'text/html'),
        'https://acme.example/mark.png': png(180),
      }
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(routes).fetcher,
        canStageSquareLogo: true,
      })
      expect(result.logo).toMatchObject({
        kind: 'square',
        stagedKey: expect.stringMatching(/^header-logos\//),
      })
      expect(result.icon?.key).toMatch(/^logos\//)
    })

    it('keeps a square SVG mark as the logo; an icon must be an image', async () => {
      const square = HOME.replace('viewBox="0 0 120 30"', 'viewBox="0 0 32 32"')
      const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': ok(square, 'text/html') })
      const result = await importBrand('acme.example', { fetcher, canStageSquareLogo: true })
      expect(result.logo).toMatchObject({ kind: 'square' })
      expect(result.icon).toBeUndefined()
      expect(result.missing).toContain('icon')
    })

    it('never takes a favicon too small to stand as the icon', async () => {
      const page = HOME.replace('<title>', '<link rel="icon" href="/fav.png" sizes="32x32"><title>')
      const routes = {
        ...SITE,
        'https://acme.example/': ok(page, 'text/html'),
        'https://acme.example/fav.png': png(32),
      }
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(routes).fetcher,
        canStageSquareLogo: true,
      })
      expect(result.icon).toBeUndefined()
      expect(result.missing).toContain('icon')
    })
  })

  it('takes no main colour from a white or grey theme colour', async () => {
    const page = HOME.replace('content="#1f4d3a"', 'content="#ffffff"')
    const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': ok(page, 'text/html') })
    // The wordmark is drawn in the brand green: that, not the white, nor a guess from the CSS.
    expect((await importBrand('acme.example', { fetcher })).primary).toBe('#1f4d3a')
    const grey = HOME.replace('content="#1f4d3a"', 'content="#ffffff"').replaceAll(
      '#1f4d3a',
      '#555555'
    )
    const { fetcher: plain } = fakeWeb({ ...SITE, 'https://acme.example/': ok(grey, 'text/html') })
    expect((await importBrand('acme.example', { fetcher: plain })).primary).toBe('#c2410c')
  })

  it('stores no logo the sanitiser refuses, never the raw markup', async () => {
    const { fetcher } = fakeWeb(SITE)
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><![CDATA[x]]></svg>'
    const result = await importBrand('acme.example', {
      fetcher,
      browser: {
        name: 'browser' as const,
        read: async () => ({
          read: { logo: { svg: hostile, widthPx: 120, heightPx: 30, from: 'header-svg' as const } },
        }),
      },
    })
    expect(seams.uploads.map((upload) => upload.body)).not.toContain(hostile)
    expect(seams.uploads.some((upload) => String(upload.body).includes('CDATA'))).toBe(false)
    expect(result.logo).toBeUndefined()
  })

  it('prefers a browser reader when one is given, with the static read filling gaps', async () => {
    const { fetcher } = fakeWeb(SITE)
    const browser = {
      name: 'browser' as const,
      read: async () => ({
        read: {
          page: { background: '#08090a' as const },
          button: { fill: '#533afd' as const, radiusPx: 9999, heightPx: 32 },
        },
      }),
    }
    const result = await importBrand('acme.example', { fetcher, browser })
    expect(result).toMatchObject({
      reader: 'browser',
      primary: '#533afd',
      background: '#08090a',
      scheme: 'dark',
      buttonShape: 'pill',
      font: { site: 'Acme Sans' },
      logo: { kind: 'wide' },
    })
  })

  describe('the site’s own font', () => {
    const regular = woff2({ family: 'Acme Sans' })
    const bold = woff2({ family: 'Acme Sans', weight: 700 })
    const browserWith = (siteFont: unknown, stack = '"Acme Sans", sans-serif') => ({
      name: 'browser' as const,
      read: async () => ({
        read: {
          page: { background: '#ffffff' as const },
          fonts: { body: { family: 'Acme Sans', stack } },
          siteFont,
        } as never,
      }),
    })
    const copied = (licence: 'open' | 'commercial') => ({
      family: 'Acme Sans',
      licence,
      files: [
        { bytes: regular, format: 'woff2', weight: 400 },
        { bytes: bold, format: 'woff2', weight: 700 },
      ],
    })

    it('uploads its files under fonts/, staged, and returns their keys beside the nearest font', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith(copied('commercial')),
      })
      expect(result.font).toMatchObject({ site: 'Acme Sans', exact: false })
      expect(result.siteFont).toEqual({
        family: 'Acme Sans',
        licence: 'commercial',
        files: [
          { key: 'fonts/2026/11/uuid-staged-import.woff2', weight: 400, style: 'normal' },
          { key: 'fonts/2026/11/uuid-staged-import.woff2', weight: 700, style: 'normal' },
        ],
      })
      const fonts = seams.uploads.filter((upload) => upload.key.startsWith('fonts/'))
      expect(fonts.map((upload) => upload.contentType)).toEqual(['font/woff2', 'font/woff2'])
      expect(seams.staged.filter((key) => key.startsWith('fonts/'))).toHaveLength(2)
    })

    it('says an open-licence font is one, and keeps a variable font’s weights', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({
          family: 'Acme Sans',
          licence: 'open',
          files: [{ bytes: regular, format: 'woff2', weight: 100, weightTo: 900 }],
        }),
      })
      expect(result.siteFont).toEqual({
        family: 'Acme Sans',
        licence: 'open',
        files: [
          {
            key: 'fonts/2026/11/uuid-staged-import.woff2',
            weight: 100,
            weightTo: 900,
            style: 'normal',
          },
        ],
      })
    })

    it('uploads nothing for a font that may not be copied, and says why', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({ family: 'Acme Sans', notCopied: 'service' }),
      })
      expect(result.siteFont).toEqual({ family: 'Acme Sans', notCopied: 'service' })
      expect(seams.uploads.some((upload) => upload.key.startsWith('fonts/'))).toBe(false)
    })

    it('knows the family however the stylesheet spells it', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({ family: 'acme-sans', notCopied: 'service' }),
      })
      expect(result.siteFont).toEqual({ family: 'Acme Sans', notCopied: 'service' })
    })

    it('uploads nothing when the portal has the same font, or the files are another family’s', async () => {
      const { fetcher } = fakeWeb(SITE)
      const same = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({ ...copied('open'), family: 'Inter' }, 'Inter, sans-serif'),
      })
      expect(same.font).toMatchObject({ id: 'inter', exact: true })
      expect(same.siteFont).toBeUndefined()
      const other = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({ ...copied('commercial'), family: 'Other Face' }),
      })
      expect(other.siteFont).toBeUndefined()
      expect(seams.uploads.some((upload) => upload.key.startsWith('fonts/'))).toBe(false)
    })

    it('falls back to the nearest font when the files cannot be stored', async () => {
      const { fetcher } = fakeWeb(SITE)
      seams.failPrefix = 'fonts/'
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith(copied('commercial')),
      })
      expect(result.siteFont).toBeUndefined()
      expect(result.logo).toBeDefined()
      expect(result.font).toMatchObject({ site: 'Acme Sans' })
    })
  })

  describe('the portal’s own domain', () => {
    it('says when the portal is on the imported site’s domain', async () => {
      const { fetcher } = fakeWeb(SITE)
      const own = await importBrand('acme.example', {
        fetcher,
        portalHosts: ['feedback.acme.example'],
      })
      expect(own.portalOnSite).toBe(true)
      const other = await importBrand('acme.example', {
        fetcher,
        portalHosts: ['acme.quackback.io'],
      })
      expect(other.portalOnSite).toBe(false)
      expect((await importBrand('acme.example', { fetcher })).portalOnSite).toBe(false)
    })
  })

  describe('a logo drawn in the text colour', () => {
    const inked = HOME.replace('fill="#1f4d3a"', 'fill="currentColor"')
    const site = { ...SITE, 'https://acme.example/': ok(inked, 'text/html') }
    const browserWith = (page: { background: `#${string}`; text?: `#${string}` }) => ({
      name: 'browser' as const,
      read: async () => ({ read: { page } }),
    })

    it('is drawn in the page text colour found, since an image cannot inherit one', async () => {
      await importBrand('acme.example', {
        fetcher: fakeWeb(site).fetcher,
        browser: browserWith({ background: '#08090a', text: '#f7f8f8' }),
      })
      expect(seams.uploads[0].body).toContain('fill="#f7f8f8"')
      expect(seams.uploads[0].body).not.toMatch(/currentcolor/i)
    })

    it.each([
      ['a light page', undefined, '#0a0a0a'],
      ['a dark page', browserWith({ background: '#08090a' }), '#fafafa'],
    ])('falls back to the automatic text colour on %s', async (_label, browser, ink) => {
      await importBrand('acme.example', { fetcher: fakeWeb(site).fetcher, browser })
      expect(seams.uploads[0].body).toContain(`fill="${ink}"`)
      expect(seams.uploads[0].body).not.toMatch(/currentcolor/i)
    })
  })

  describe('a logo that would vanish on the page', () => {
    const withLogo = (svg: string, background: `#${string}` = '#ffffff') => ({
      name: 'browser' as const,
      read: async () => ({
        read: {
          page: { background },
          logo: { svg, widthPx: 120, heightPx: 30, from: 'header-svg' as const },
        },
      }),
    })

    it('redraws a one-colour logo in the text colour', async () => {
      const white = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#ffffff"/></svg>'
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(white),
      })
      expect(result.logo?.kind).toBe('wide')
      expect(seams.uploads[0].body).toContain('fill="#0a0a0a"')
      expect(seams.uploads[0].body).not.toContain('#ffffff')
    })

    it('redraws it in a colour that reads on the page, not a hero’s white text', async () => {
      const white = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#ffffff"/></svg>'
      const browser = {
        name: 'browser' as const,
        read: async () => ({
          read: {
            page: { background: '#ffffff' as const, text: '#ffffff' as const },
            logo: { svg: white, widthPx: 120, heightPx: 30, from: 'header-svg' as const },
          },
        }),
      }
      await importBrand('acme.example', { fetcher: fakeWeb(SITE).fetcher, browser })
      expect(seams.uploads[0].body).toContain('fill="#0a0a0a"')
    })

    it('reads a colour given by name: a logo drawn in white is redrawn on a white page', async () => {
      const white = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="white"/></svg>'
      await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(white),
      })
      expect(seams.uploads[0].body).toContain('fill="#0a0a0a"')
      expect(seams.uploads[0].body).not.toContain('white')
    })

    it('keeps a logo drawn in white by name on a dark page, as valid markup', async () => {
      const white =
        '<svg viewBox="0 0 120 30" fill="none"><path d="M0 0h120v30H0z" fill="white"/></svg>'
      await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(white, '#1a2081'),
      })
      const svg = seams.uploads[0].body
      expect(svg).toContain('fill="white"')
      // One fill on the root element: a second would make the file unreadable.
      expect(/<svg\b[^>]*>/.exec(svg)![0].match(/\sfill=/g)).toHaveLength(1)
    })

    it('never writes a second fill on a logo whose root already has one', async () => {
      const bare = '<svg viewBox="0 0 120 30" fill="none"><path d="M0 0h120v30H0z"/></svg>'
      await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(bare, '#101010'),
      })
      const root = /<svg\b[^>]*>/.exec(seams.uploads[0].body)![0]
      expect(root.match(/\sfill=/g)).toHaveLength(1)
      expect(root).toContain('fill="#fafafa"')
    })

    it('leaves out a logo of several colours that would not show, rather than stage it', async () => {
      const pale =
        '<svg viewBox="0 0 120 30"><path d="M0 0h60v30H0z" fill="#ffffff"/><path d="M60 0h60v30H60z" fill="#f4f4f4"/></svg>'
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(pale),
      })
      expect(result.logo).toBeUndefined()
      expect(result.missing).toContain('logo')
      expect(seams.uploads).toHaveLength(0)
    })

    it('goes by the inks the reader drew it in: a logo whose main ink vanishes is left out', async () => {
      const wordmark =
        '<svg viewBox="0 0 120 30"><path d="M0 0h20v30H0z" fill="#306998"/><path d="M24 4h96v22H24z" fill="#ffffff"/></svg>'
      const drawn = (background: `#${string}`) => ({
        name: 'browser' as const,
        read: async () => ({
          read: {
            page: { background },
            logo: {
              svg: wordmark,
              widthPx: 120,
              heightPx: 30,
              from: 'header-svg' as const,
              inks: [
                { color: '#ffffff' as const, share: 0.7 },
                { color: '#306998' as const, share: 0.3 },
              ],
            },
          },
        }),
      })
      const onWhite = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: drawn('#ffffff'),
      })
      expect(onWhite.logo).toBeUndefined()
      expect(onWhite.missing).toContain('logo')
      expect(seams.uploads).toHaveLength(0)
      // The same logo on a dark page shows, and is kept as drawn.
      const onDark = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: drawn('#101418'),
      })
      expect(onDark.logo?.kind).toBe('wide')
    })

    it('goes by the markup when the inks are not the markup’s: a logo styled by the page draws black on its own', async () => {
      // White on the site's dark bar, by its markup; counted as all black when drawn alone.
      const white = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#ffffff"/></svg>'
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: {
          name: 'browser' as const,
          read: async () => ({
            read: {
              page: { background: '#ffffff' as const, header: '#0a0a23' as const },
              logo: {
                svg: white,
                widthPx: 120,
                heightPx: 30,
                from: 'header-svg' as const,
                inks: [{ color: '#000000' as const, share: 1 }],
              },
            },
          }),
        },
      })
      expect(result.logo?.kind).toBe('wide')
    })

    it('stages the site’s own dark-mode logo beside the logo, as it is, and never for a dark site', async () => {
      const light = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#17332b"/></svg>'
      const dark = '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#e8f1ee"/></svg>'
      const reader = (background: `#${string}`) => ({
        name: 'browser' as const,
        read: async () => ({
          read: {
            page: { background },
            logo: { svg: light, widthPx: 120, heightPx: 30, from: 'header-svg' as const },
            darkLogo: {
              svg: dark,
              widthPx: 120,
              heightPx: 30,
              from: 'header-svg' as const,
              how: 'scheme' as const,
            },
          },
        }),
      })
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: reader('#ffffff'),
      })
      expect(result.logoDark?.stagedKey).toMatch(/^header-logos\//)
      // Both are stored: the logo, and the dark one as the site drew it, in no ink of ours.
      const stored = seams.uploads
        .filter((upload) => upload.key.startsWith('header-logos/'))
        .map((upload) => String(upload.body))
      expect(stored).toHaveLength(2)
      expect(stored[0]).toContain('#17332b')
      expect(stored[1]).toContain('#e8f1ee')
      seams.uploads.length = 0
      const onDark = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: reader('#0b0f0e'),
      })
      expect(onDark.logoDark).toBeUndefined()
    })

    it('keeps a logo that shows, whatever its colours', async () => {
      const result = await importBrand('acme.example', {
        fetcher: fakeWeb(SITE).fetcher,
        browser: withLogo(
          '<svg viewBox="0 0 120 30"><path d="M0 0h120v30H0z" fill="#ffffff"/><path d="M0 0h20v30H0z" fill="#5865f2"/></svg>',
          '#ffffff'
        ),
      })
      expect(result.logo?.kind).toBe('wide')
      expect(seams.uploads[0].body).toContain('#5865f2')
    })
  })

  it('reads the local version for the admin’s language when the homepage is a country picker', async () => {
    const versions = ['de-DE', 'fr-FR', 'en-US', 'es-ES', 'it-IT']
      .map(
        (lang) =>
          `<link rel="alternate" hreflang="${lang}" href="https://acme.example/${lang.toLowerCase()}/">`
      )
      .join('')
    const picker = `<!doctype html><html><head><title>Choose your country</title>${versions}<link rel="alternate" hreflang="en-GB" href="https://acme.example/gb/en/"></head><body><h1>Hej!</h1></body></html>`
    const { fetcher, calls } = fakeWeb({
      ...SITE,
      'https://acme.example/': ok(picker, 'text/html'),
      'https://acme.example/gb/en/': ok(HOME, 'text/html'),
    })
    const result = await importBrand('acme.example', { fetcher, languages: ['en-gb', 'en'] })
    expect(calls.map((call) => call.url)).toContain('https://acme.example/gb/en/')
    expect(result).toMatchObject({
      host: 'acme.example',
      primary: '#1f4d3a',
      logo: { kind: 'wide' },
    })
  })

  describe('a page that is not the site', () => {
    const html = (title: string, body: string) =>
      ok(`<html><head><title>${title}</title></head><body>${body}</body></html>`, 'text/html')
    const failing = (failed: 'challenge' | 'error' | 'picker' | 'unreachable', more = {}) => ({
      name: 'browser' as const,
      read: async () => ({ failed, ...more }),
    })
    const wall = html('Access Denied', 'Denied')

    it('says the site asked for proof of a human, and imports nothing', async () => {
      const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': wall })
      const refusal = await importBrand('acme.example', {
        fetcher,
        browser: failing('challenge'),
      }).catch((err: unknown) => err)
      expect(refusal).toBeInstanceOf(SiteNotReadError)
      expect(refusal).toMatchObject({
        code: 'SITE_BLOCKED',
        reason: 'bot',
        host: 'acme.example',
        message:
          'acme.example asked us to prove we’re human. Nothing changed. If it’s your site, allow our reader: QuackbackBrandReader',
      })
      expect(seams.uploads).toEqual([])
    })

    it('says the site showed an error page: by its status, or by what it says', async () => {
      const down = {
        ...ok('<html><head><title>Acme</title></head><body>Oops</body></html>', 'text/html'),
        status: 503,
      }
      for (const page of [
        down,
        html('Error Page | Acme', '<h1>Sorry</h1><p>Something went wrong on our end.</p>'),
        html('Acme', '<h1>We’re working on it.</h1><p>System maintenance is in progress.</p>'),
      ]) {
        const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': page })
        await expect(importBrand('acme.example', { fetcher })).rejects.toMatchObject({
          code: 'SITE_ERROR_PAGE',
          reason: 'error',
          host: 'acme.example',
          message:
            'acme.example showed an error page. Nothing changed. Try again in a few minutes.',
        })
      }
      expect(seams.uploads).toEqual([])
    })

    it('says the site opened a country picker, with up to three of its addresses, the admin’s country first', async () => {
      const countries = ['Canada', 'United States', 'Mexico', 'France', 'Germany', 'United Kingdom']
      const picker = html(
        'Acme International: Select your Country',
        `<h1>Hello! Choose a country.</h1>${countries
          .map((name) => `<a href="/${name.toLowerCase().replace(' ', '-')}">${name}</a>`)
          .join('')}`
      )
      const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': picker })
      await expect(
        importBrand('acme.example', { fetcher, languages: ['en-gb', 'en'] })
      ).rejects.toMatchObject({
        code: 'SITE_PICKER',
        reason: 'picker',
        host: 'acme.example',
        candidates: [
          'https://acme.example/united-kingdom',
          'https://acme.example/united-states',
          'https://acme.example/canada',
        ],
        message:
          'acme.example opened a country picker. Nothing changed. Pick your site to import it.',
      })
    })

    it('uses the reader that got the real page when the other did not', async () => {
      // The browser met a bot check, an error page or a picker; the static reader read the site.
      for (const failed of ['challenge', 'error', 'picker'] as const) {
        const { fetcher } = fakeWeb(SITE)
        const result = await importBrand('acme.example', { fetcher, browser: failing(failed) })
        expect(result).toMatchObject({ reader: 'static', primary: '#1f4d3a' })
      }
      // And the other way round: the static reader met the wall, the browser read the site.
      const { fetcher } = fakeWeb({ ...SITE, 'https://acme.example/': wall })
      const browser = {
        name: 'browser' as const,
        read: async () => ({
          read: {
            page: { background: '#ffffff' as const },
            button: { fill: '#1f4d3a' as const },
          },
        }),
      }
      expect(await importBrand('acme.example', { fetcher, browser })).toMatchObject({
        reader: 'browser',
        primary: '#1f4d3a',
      })
    })

    it('refuses when one reader was turned away and the other read nothing of the brand', async () => {
      // An app's empty shell to the static reader; a bot check to the browser.
      const shell = html('Acme', '<div id="root"></div>')
      const { fetcher } = fakeWeb({
        'https://acme.example/robots.txt': null,
        'https://acme.example/': shell,
      })
      await expect(
        importBrand('acme.example', { fetcher, browser: failing('challenge') })
      ).rejects.toMatchObject({ code: 'SITE_BLOCKED', reason: 'bot' })
      // With no reader turned away, a thin read is still a read.
      const again = fakeWeb({
        'https://acme.example/robots.txt': null,
        'https://acme.example/': shell,
      })
      await expect(
        importBrand('acme.example', { fetcher: again.fetcher, browser: failing('unreachable') })
      ).resolves.toMatchObject({ host: 'acme.example' })
    })

    it('still says it could not reach a site neither reader could fetch', async () => {
      const { fetcher } = fakeWeb({ 'https://acme.example/robots.txt': null })
      await expect(
        importBrand('acme.example', { fetcher, browser: failing('unreachable') })
      ).rejects.toMatchObject({ code: 'SITE_UNREACHABLE' })
    })
  })

  it('falls back to the static read when the browser reader fails', async () => {
    const { fetcher } = fakeWeb(SITE)
    const browser = {
      name: 'browser' as const,
      read: async () => ({ failed: 'unreachable' as const }),
    }
    const result = await importBrand('acme.example', { fetcher, browser })
    expect(result).toMatchObject({ reader: 'static', primary: '#1f4d3a' })
  })

  describe('the site’s headings font', () => {
    const semibold = woff2({ family: 'Acme Display', weight: 600 })
    const bold = woff2({ family: 'Acme Display', weight: 700 })
    const browserWith = (headline: string, siteHeadingFont?: unknown) => ({
      name: 'browser' as const,
      read: async () => ({
        read: {
          page: { background: '#ffffff' as const },
          fonts: {
            body: { family: 'Inter', stack: 'Inter, sans-serif' },
            headline: { family: headline.split(',')[0], stack: headline },
          },
          ...(siteHeadingFont ? { siteHeadingFont } : {}),
        } as never,
      }),
    })
    const files = [
      { bytes: semibold, format: 'woff2', weight: 600 },
      { bytes: bold, format: 'woff2', weight: 700 },
    ]

    it('copies a family of the site’s own: its semibold and bold, staged under fonts/', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith('"Acme Display", serif', {
          family: 'Acme Display',
          licence: 'open',
          files,
        }),
      })
      expect(result.headings).toEqual({ site: 'Acme Display' })
      expect(result.siteHeadingFont).toEqual({
        family: 'Acme Display',
        licence: 'open',
        files: [
          { key: 'fonts/2026/11/uuid-staged-import.woff2', weight: 600, style: 'normal' },
          { key: 'fonts/2026/11/uuid-staged-import.woff2', weight: 700, style: 'normal' },
        ],
      })
      expect(seams.staged.filter((key) => key.startsWith('fonts/'))).toHaveLength(2)
    })

    it('says why a family could not be copied', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith('"Acme Display", serif', {
          family: 'Acme Display',
          notCopied: 'service',
        }),
      })
      expect(result.headings).toEqual({ site: 'Acme Display' })
      expect(result.siteHeadingFont).toEqual({ family: 'Acme Display', notCopied: 'service' })
    })

    it('copies nothing for a font the portal has, which it loads itself', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith('Manrope, sans-serif', { family: 'Manrope', licence: 'open', files }),
      })
      expect(result.headings).toEqual({ site: 'Manrope', id: 'manrope' })
      expect(result.siteHeadingFont).toBeUndefined()
      expect(seams.uploads.filter((upload) => upload.key.startsWith('fonts/'))).toEqual([])
    })

    it('copies nothing when the headings are a cut of the text font, or files of some other family', async () => {
      const { fetcher } = fakeWeb(SITE)
      const cut = await importBrand('acme.example', {
        fetcher,
        browser: browserWith('"Inter Display", sans-serif', {
          family: 'Inter Display',
          licence: 'open',
          files,
        }),
      })
      expect(cut.headings).toBeUndefined()
      expect(cut.siteHeadingFont).toBeUndefined()
      const other = await importBrand('acme.example', {
        fetcher,
        browser: browserWith('"Acme Display", serif', {
          family: 'Elsewhere',
          licence: 'open',
          files,
        }),
      })
      expect(other.headings).toEqual({ site: 'Acme Display' })
      expect(other.siteHeadingFont).toBeUndefined()
      expect(seams.uploads.filter((upload) => upload.key.startsWith('fonts/'))).toEqual([])
    })
  })

  describe('the site’s name', () => {
    const browserWith = (read: Record<string, unknown>) => ({
      name: 'browser' as const,
      read: async () => ({ read: { page: { background: '#ffffff' as const }, ...read } as never }),
    })

    it('is the name the site declares for itself', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        browser: browserWith({ siteName: ' Acme   Parcel ', title: 'Send a parcel | Acme' }),
      })
      expect(result.siteName).toBe('Acme Parcel')
    })

    it('is the name in the title otherwise: the part that names the site', async () => {
      const { fetcher } = fakeWeb(SITE)
      const named = (title: string) =>
        importBrand('acme.example', { fetcher, browser: browserWith({ title }) }).then(
          (result) => result.siteName
        )
      expect(await named('Acme | Parcels, delivered')).toBe('Acme')
      expect(await named('Parcels, delivered - Acme')).toBe('Acme')
    })

    it('holds a declared name to the domain, as it does the title', async () => {
      const { fetcher } = fakeWeb(SITE)
      const result = await importBrand('acme.example', {
        fetcher,
        // A strapline declared as the site's name, and the app's name after it.
        browser: browserWith({
          siteName: 'Love your parcels',
          names: ['Official Acme Site'],
          title: 'Send a parcel today',
        }),
      })
      expect(result.siteName).toBe('Acme')
    })

    it('is the domain’s own word when nothing the site says spells it, and nothing when it says nothing', () => {
      const url = 'https://acme.example/'
      expect(siteNameOf({ siteName: 'Love your parcels', title: 'Send a parcel today' }, url)).toBe(
        'Acme'
      )
      expect(siteNameOf({ siteName: '   ' }, url)).toBeUndefined()
      expect(siteNameOf({}, url)).toBeUndefined()
      // A name too long to use falls back to the title's.
      expect(siteNameOf({ siteName: 'A'.repeat(101), title: 'Acme | Parcels' }, url)).toBe('Acme')
    })
  })
})
