import { beforeEach, describe, expect, it, vi } from 'vitest'
import { icoOf, pngOf } from '@/lib/server/content/__tests__/image-fixtures'
import type { FetchedBody, SiteFetcher, SiteFetchKind } from '../types'

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => logs },
}))
const fetchFollowingRedirects = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/content/unfurl', () => ({ fetchFollowingRedirects }))

import { isStandardWebsiteUrl } from '@/lib/shared/website-branding'
import { READER_TOKEN } from '../../robots'
import { liveSiteFetcher, pickStylesheets, rankFavicons, readSite } from '../site-read'
import { registrableDomain } from '@/lib/shared/registrable-domain'
import { brandReadFromSite } from '../../static-reader'
import { woff2 } from './font-fixture'

const enc = (s: string) => new TextEncoder().encode(s)
const html = (body: string): FetchedBody => ({
  status: 200,
  url: '',
  contentType: 'text/html; charset=utf-8',
  body: enc(body),
})
const css = (body: string): FetchedBody => ({
  status: 200,
  url: '',
  contentType: 'text/css',
  body: enc(body),
})
const image = (bytes: Uint8Array, contentType = 'image/png'): FetchedBody => ({
  status: 200,
  url: '',
  contentType,
  body: bytes,
})

type Route = FetchedBody | null | (() => FetchedBody | null)
interface Call {
  url: string
  kind: SiteFetchKind
  maxBytes: number
  timeoutMs: number
}

function fakeFetcher(routes: Record<string, Route>, onCall?: (call: Call) => void) {
  const calls: Call[] = []
  const fetcher: SiteFetcher = async (url, kind, limits) => {
    const call = { url, kind, ...limits }
    calls.push(call)
    onCall?.(call)
    const route = routes[url]
    const res = typeof route === 'function' ? route() : route
    return res ? { ...res, url: res.url || url } : null
  }
  return { fetcher, calls }
}

const LOGO_SVG =
  '<svg viewBox="0 0 120 32"><title>Acme Parcel</title><path d="M0 0h120v32H0z" fill="currentColor"/><script>x()</script></svg>'

const HOME = `<!doctype html><html lang="en"><head>
  <title>Acme Parcel | Parcels, delivered</title>
  <meta property="og:image" content="/share.png">
  <meta name="theme-color" content="#fe5e86">
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
  <link rel="icon" href="/favicon-64.png" sizes="64x64" type="image/png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="stylesheet" href="/main.css">
  <style>h1{font-family:Lora,serif}</style>
</head><body class="font-body"><header><a href="/">${LOGO_SVG}</a></header><h1>Parcels</h1></body></html>`

beforeEach(() => {
  logs.info.mockReset()
  logs.warn.mockReset()
  fetchFollowingRedirects.mockReset()
})

describe('readSite', () => {
  it('reads the page, stylesheets, manifest and images', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://acme.test/': html(HOME),
      'https://acme.test/main.css': css(
        ':root{--brand:#fe5e86} .font-body{font-family:Inter,sans-serif}'
      ),
      'https://acme.test/site.webmanifest': {
        status: 200,
        url: '',
        contentType: 'application/manifest+json',
        body: enc(
          JSON.stringify({ icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] })
        ),
      },
      'https://acme.test/favicon-64.png': image(pngOf(64, 64)),
      'https://acme.test/icon-192.png': image(pngOf(192, 192)),
      'https://acme.test/share.png': image(pngOf(1200, 630)),
    })
    const read = await readSite('acme.test', fetcher, { logoInk: '#111111', now: () => 0 })
    expect(read.failed).toBeNull()
    expect(read.facts).toMatchObject({
      url: 'https://acme.test/',
      name: 'Acme Parcel',
      themeColour: '#fe5e86',
      stylesheets: ['https://acme.test/main.css'],
      fonts: { heading: { family: 'Lora' }, body: { family: 'Inter' } },
    })
    expect(read.facts?.favicons.map((icon) => icon.from)).toEqual(['icon', 'icon', 'manifest'])
    expect(read.favicon).toMatchObject({
      url: 'https://acme.test/favicon-64.png',
      mime: 'image/png',
      width: 64,
      from: 'icon',
    })
    // The icon is the largest the site declares, not the small favicon.
    expect(read.icon).toMatchObject({
      url: 'https://acme.test/icon-192.png',
      mime: 'image/png',
      width: 192,
      from: 'manifest',
    })
    expect(read.logo).toMatchObject({
      mime: 'image/svg+xml',
      width: 120,
      height: 32,
      from: 'header-svg',
    })
    const svg = new TextDecoder().decode(read.logo!.bytes)
    expect(svg).toContain('fill="#111111"')
    expect(svg).not.toContain('script')
    expect(read.shareImage).toMatchObject({ width: 1200, height: 630, from: 'share' })
    expect(calls.map((c) => [c.kind, c.url])).toEqual([
      ['page', 'https://acme.test/'],
      ['css', 'https://acme.test/main.css'],
      ['manifest', 'https://acme.test/site.webmanifest'],
      ['image', 'https://acme.test/favicon-64.png'],
      ['image', 'https://acme.test/icon-192.png'],
      ['image', 'https://acme.test/share.png'],
    ])
    expect(calls[0]).toMatchObject({ maxBytes: 1_000_000, timeoutMs: 15_000 })
    expect(logs.info).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'acme.test', stylesheets: 1 }),
      'site read'
    )
  })

  it('reads the files its own @font-face rules serve for the text, so an open-licence font can be copied', async () => {
    const open = { licenceUrl: 'https://scripts.sil.org/OFL' }
    const font = (bytes: Uint8Array): FetchedBody => ({
      status: 200,
      url: '',
      contentType: 'font/woff2',
      body: bytes,
    })
    const page = `<!doctype html><html><head><title>Northwind</title>
      <link rel="stylesheet" href="/site.css"></head><body><p>Hello</p></body></html>`
    const sheet = `
      @font-face { font-family: "Figtree"; src: url(/fonts/figtree.woff2) format("woff2"); font-weight: 400; }
      @font-face { font-family: "Figtree"; src: url(/fonts/figtree-bold.woff2) format("woff2"); font-weight: 700; }
      body { font-family: "Figtree", ui-sans-serif, sans-serif; }`
    const { fetcher, calls } = fakeFetcher({
      'https://northwind.example/': html(page),
      'https://northwind.example/site.css': css(sheet),
      'https://northwind.example/fonts/figtree.woff2': font(woff2(open)),
      'https://northwind.example/fonts/figtree-bold.woff2': font(woff2({ ...open, weight: 700 })),
    })
    const site = await readSite('https://northwind.example/', fetcher)
    expect(site.fonts?.text).toMatchObject({
      family: 'Figtree',
      files: [{ weight: 400 }, { weight: 700 }],
    })
    // Fonts are asked for as fonts, under the copy limit (one byte over, to tell a large file).
    expect(calls.filter((call) => call.kind === 'font').map((call) => call.maxBytes)).toEqual([
      400 * 1024 + 1,
      400 * 1024 + 1,
    ])
    // The static reader classifies them as the browser reader does: open, so applied with no hold.
    expect(brandReadFromSite(site).siteFont).toMatchObject({ family: 'Figtree', licence: 'open' })
  })

  it('takes no font the budget could only hold part of, however whole it may parse', async () => {
    const open = { licenceUrl: 'https://scripts.sil.org/OFL' }
    // Trailing bytes past the tables a parser reads: cut there, the file still parses.
    const whole = new Uint8Array([...woff2(open), ...new Uint8Array(1000)])
    const page = enc(
      `<!doctype html><html><head><title>N</title><link rel="stylesheet" href="/s.css"></head><body><p>Hi</p></body></html>`
    )
    const sheet = enc(
      `@font-face { font-family: "Figtree"; src: url(/f.woff2) format("woff2"); font-weight: 400; } body { font-family: "Figtree", sans-serif; }`
    )
    const routes = {
      'https://northwind.example/': { status: 200, url: '', contentType: 'text/html', body: page },
      'https://northwind.example/s.css': {
        status: 200,
        url: '',
        contentType: 'text/css',
        body: sheet,
      },
      'https://northwind.example/f.woff2': {
        status: 200,
        url: '',
        contentType: 'font/woff2',
        body: whole,
      },
    }
    // Enough left for all but the last 500 bytes of the font.
    const budgetBytes = page.byteLength + sheet.byteLength + whole.byteLength - 500
    const cut = await readSite('https://northwind.example/', fakeFetcher(routes).fetcher, {
      budgetBytes,
    })
    expect(cut.fonts?.text?.files ?? []).toEqual([])
    // With room for it, the same file is taken whole.
    const full = await readSite('https://northwind.example/', fakeFetcher(routes).fetcher)
    expect(full.fonts?.text?.files[0]?.bytes.byteLength).toBe(whole.byteLength)
  })

  it('reads no font files for a page set in a system font', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://northwind.example/': html(
        '<!doctype html><html><head><title>N</title><style>body{font-family:system-ui}</style></head><body><p>Hi</p></body></html>'
      ),
    })
    const site = await readSite('https://northwind.example/', fetcher)
    expect(site.fonts).toBeUndefined()
    expect(calls.some((call) => call.kind === 'font')).toBe(false)
  })

  it('reads at most twelve stylesheets, the site’s own first, parsed in document order', async () => {
    const own = Array.from({ length: 13 }, (_, i) => `/s${i}.css`)
    const links = [
      'https://cdn.other.example/a.css',
      ...own.slice(0, 6),
      'https://static.acme.test/c.css',
      ...own.slice(6),
    ]
    const page = `<html><head>${links.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head><body></body></html>`
    const routes: Record<string, Route> = { 'https://acme.test/': html(page) }
    for (const [i, href] of own.entries())
      routes[`https://acme.test${href}`] = css(`body{font-family:Face${i}}`)
    routes['https://static.acme.test/c.css'] = css('body{font-family:Facec}')
    const { fetcher, calls } = fakeFetcher(routes)
    const read = await readSite('https://acme.test', fetcher)
    const expected = [
      ...own.slice(0, 6).map((href) => `https://acme.test${href}`),
      'https://static.acme.test/c.css',
      ...own.slice(6, 11).map((href) => `https://acme.test${href}`),
    ]
    expect(calls.filter((c) => c.kind === 'css').map((c) => c.url)).toEqual(expected)
    expect(read.facts?.stylesheets).toEqual(expected)
    expect(read.facts?.fonts.body?.family).toBe('Face10')
  })

  it('leaves room for every stylesheet after a large page', async () => {
    const links = Array.from({ length: 8 }, (_, i) => `/s${i}.css`)
    const page = `<html><head>${links.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head><body>${'x'.repeat(990_000)}</body></html>`
    const routes: Record<string, Route> = { 'https://acme.test/': html(page) }
    for (const href of links)
      routes[`https://acme.test${href}`] = css(`.a${href.length}{color:red}`)
    const { fetcher } = fakeFetcher(routes)
    const read = await readSite('https://acme.test', fetcher)
    expect(read.facts?.stylesheets).toHaveLength(8)
  })

  it('stops at a bot challenge, keeping what the page says', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://acme.test/': {
        ...html(
          '<html lang="en"><head><title>Just a moment...</title></head><body>Checking</body></html>'
        ),
        status: 503,
      },
    })
    const read = await readSite('acme.test', fetcher)
    expect(read).toMatchObject({ failed: 'challenge', favicon: null, logo: null, shareImage: null })
    expect(read.facts?.language).toBe('en')
    expect(calls).toHaveLength(1)
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'acme.test', failed: 'challenge' }),
      'site read failed'
    )
  })

  it('refuses a page that is not HTML', async () => {
    const { fetcher } = fakeFetcher({
      'https://acme.test/': {
        status: 200,
        url: '',
        contentType: 'application/pdf',
        body: enc('%PDF-1.7'),
      },
    })
    expect(await readSite('acme.test', fetcher)).toMatchObject({ failed: 'not_html', facts: null })
  })

  it('accepts HTML served without a content type', async () => {
    const { fetcher } = fakeFetcher({
      'https://acme.test/': {
        ...html('<!DOCTYPE html><html><head><title>Acme</title></head></html>'),
        contentType: '',
      },
    })
    expect((await readSite('acme.test', fetcher)).facts?.name).toBe('Acme')
  })

  it('fails a page that cannot be fetched, and says when the site answered with an error page', async () => {
    expect((await readSite('acme.test', fakeFetcher({}).fetcher)).failed).toBe('fetch_failed')
    const { fetcher } = fakeFetcher({
      'https://acme.test/': { ...html('<p>Server error</p>'), status: 500 },
    })
    expect((await readSite('acme.test', fetcher)).failed).toBe('error_page')
  })

  it('says when the page is a country picker, and hands back its links', async () => {
    const countries = ['Canada', 'United States', 'Mexico', 'France']
    const { fetcher } = fakeFetcher({
      'https://acme.test/': html(
        `<h1>Choose a country</h1>${countries.map((name) => `<a href="/${name[0]}">${name}</a>`).join('')}`
      ),
    })
    const read = await readSite('acme.test', fetcher)
    expect(read.failed).toBe('picker')
    expect(read.links?.map((link) => link.text)).toEqual(countries)
  })

  it.each([
    'http://localhost/',
    'localhost',
    'http://127.0.0.1/',
    'http://10.0.0.8',
    'http://[::1]/',
    'https://user:secret@acme.test/',
    'https://acme.test:8080/',
    'ftp://acme.test/',
    'intranet',
    '',
  ])('refuses %s without fetching', async (url) => {
    const { fetcher, calls } = fakeFetcher({})
    expect(await readSite(url, fetcher)).toEqual({
      facts: null,
      favicon: null,
      icon: null,
      logo: null,
      shareImage: null,
      failed: 'blocked_url',
    })
    expect(calls).toHaveLength(0)
  })

  it('keeps every fetch inside the byte budget', async () => {
    const page = `<html><head><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"><link rel="icon" href="/i.png" sizes="64x64" type="image/png"></head><body></body></html>`
    const { fetcher, calls } = fakeFetcher({
      'https://acme.test/': html(page),
      'https://acme.test/a.css': css(`body{font-family:Inter}/*${'x'.repeat(5_000)}*/`),
      'https://acme.test/b.css': css('h1{font-family:Lora}'),
      'https://acme.test/i.png': image(pngOf(64, 64)),
    })
    const budgetBytes = page.length + 3_000
    const read = await readSite('acme.test', fetcher, { budgetBytes })
    const cssCalls = calls.filter((c) => c.kind === 'css')
    expect(cssCalls[0].maxBytes).toBe(3_000)
    // The first sheet reserved what was left; the second had nothing to ask for.
    expect(cssCalls).toHaveLength(1)
    expect(calls.filter((c) => c.kind === 'image')).toHaveLength(0)
    expect(read.favicon).toBeNull()
    // The cut sheet is still read as far as it goes.
    expect(read.facts?.fonts.body?.family).toBe('Inter')
  })

  it('cuts a body the fetcher returns past its limit', async () => {
    const { fetcher } = fakeFetcher({
      'https://acme.test/': html(
        `<html><head><title>Acme Parcel</title></head><body>${'x'.repeat(10_000)}</body></html>`
      ),
    })
    const read = await readSite('acme.test', fetcher, { budgetBytes: 60 })
    expect(read.facts?.name).toBe('Acme Parcel')
  })

  it('stops fetching when the time budget runs out', async () => {
    let clock = 0
    const page = `<html><head><link rel="stylesheet" href="/a.css"><link rel="icon" href="/a.png" sizes="64x64" type="image/png"><link rel="icon" href="/b.png" sizes="128x128" type="image/png"></head><body><header><a href="/">${LOGO_SVG}</a></header></body></html>`
    const { fetcher, calls } = fakeFetcher(
      {
        'https://acme.test/': html(page),
        'https://acme.test/a.css': css('body{font-family:Inter}'),
        'https://acme.test/a.png': image(enc('not an image at all')),
        'https://acme.test/b.png': image(pngOf(128, 128)),
      },
      () => {
        clock += 6_000
      }
    )
    const read = await readSite('acme.test', fetcher, { now: () => clock, budgetMs: 15_000 })
    expect(calls.map((c) => [c.url, c.timeoutMs])).toEqual([
      ['https://acme.test/', 15_000],
      ['https://acme.test/a.css', 9_000],
      ['https://acme.test/a.png', 3_000],
    ])
    expect(read.favicon).toBeNull()
    // The inline logo needs no fetch, so it survives the budget.
    expect(read.logo?.from).toBe('header-svg')
    expect(read.facts?.fonts.body?.family).toBe('Inter')
  })

  it('verifies images by their bytes and refuses oversized or disguised ones', async () => {
    const page = `<html><head><meta property="og:image" content="/share.svg"><link rel="icon" href="/fake.png" sizes="64x64" type="image/png"><link rel="icon" href="/huge.png" sizes="96x96" type="image/png"></head><body><header><a href="/"><img src="/logo.svg" alt="Acme Parcel"></a></header></body></html>`
    const { fetcher } = fakeFetcher({
      'https://acme.test/': html(page),
      'https://acme.test/fake.png': image(enc('<html>not found</html>')),
      'https://acme.test/huge.png': image(pngOf(5000, 5000)),
      'https://acme.test/favicon.ico': image(icoOf(32, 16), 'image/x-icon'),
      'https://acme.test/logo.svg': image(
        enc('<svg width="80" height="20"><rect width="80" height="20" fill="currentColor"/></svg>'),
        'image/svg+xml'
      ),
      'https://acme.test/share.svg': image(
        enc('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
        'image/svg+xml'
      ),
    })
    const read = await readSite('acme.test', fetcher, { logoInk: '#222222' })
    expect(read.favicon).toMatchObject({
      url: 'https://acme.test/favicon.ico',
      mime: 'image/x-icon',
      width: 32,
    })
    expect(read.logo).toMatchObject({
      from: 'header-img',
      mime: 'image/svg+xml',
      width: 80,
      height: 20,
    })
    expect(new TextDecoder().decode(read.logo!.bytes)).toContain('fill="#222222"')
    expect(read.shareImage).toBeNull()
  })

  it('lets a throwing fetcher’s error through', async () => {
    const fetcher: SiteFetcher = async () => {
      throw new Error('No snapshot of https://acme.test/')
    }
    await expect(readSite('acme.test', fetcher)).rejects.toThrow('No snapshot')
  })
})

describe('readSite: a page below the homepage', () => {
  it('reads the page at the path it is given, on the host it checked', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://acme.test/gb/en/': html(
        '<!doctype html><html><head><title>Acme UK</title></head><body><h1>Hi</h1></body></html>'
      ),
    })
    const read = await readSite('https://acme.test/gb/en/', fetcher, { now: () => 0 })
    expect(read.facts?.url).toBe('https://acme.test/gb/en/')
    expect(calls[0]?.url).toBe('https://acme.test/gb/en/')
  })
})

describe('readSite: the app icon', () => {
  const page = (icons: string) =>
    html(
      `<!doctype html><html><head><title>Acme</title>${icons}</head><body><h1>Hi</h1></body></html>`
    )

  it('takes the large PNG inside a /favicon.ico when the site declares nothing larger', async () => {
    const large = pngOf(256, 256)
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header.writeUInt32LE(large.length, 6 + 8)
    header.writeUInt32LE(22, 6 + 12)
    const { fetcher } = fakeFetcher({
      'https://acme.test/': page(''),
      'https://acme.test/favicon.ico': image(Buffer.concat([header, large]), 'image/x-icon'),
    })
    const read = await readSite('acme.test', fetcher, { now: () => 0 })
    expect(read.icon).toMatchObject({ mime: 'image/png', width: 256, height: 256 })
  })

  it('reads a large /favicon.ico whole for the icon, though the favicon read takes less of it', async () => {
    // One 256px 32-bit bitmap: about 270 KB, past the favicon's own limit.
    const side = 256
    const bitmap = Buffer.alloc(40 + side * side * 4 + side * 32)
    bitmap.writeUInt32LE(40, 0)
    bitmap.writeInt32LE(side, 4)
    bitmap.writeInt32LE(side * 2, 8)
    bitmap.writeUInt16LE(1, 12)
    bitmap.writeUInt16LE(32, 14)
    const dir = Buffer.alloc(22)
    dir.writeUInt16LE(1, 2)
    dir.writeUInt16LE(1, 4)
    dir.writeUInt32LE(bitmap.length, 6 + 8)
    dir.writeUInt32LE(22, 6 + 12)
    const { fetcher } = fakeFetcher({
      'https://acme.test/': page(''),
      'https://acme.test/favicon.ico': image(Buffer.concat([dir, bitmap]), 'image/x-icon'),
    })
    const read = await readSite('acme.test', fetcher, { now: () => 0 })
    expect(read.icon).toMatchObject({ mime: 'image/png', width: 256, height: 256 })
  })

  it('has no icon when every icon is too small to stand as one', async () => {
    const { fetcher } = fakeFetcher({
      'https://acme.test/': page(
        '<link rel="icon" href="/fav-48.png" sizes="48x48" type="image/png">'
      ),
      'https://acme.test/fav-48.png': image(pngOf(48, 48)),
      'https://acme.test/favicon.ico': image(pngOf(32, 32)),
    })
    expect((await readSite('acme.test', fetcher, { now: () => 0 })).icon).toBeNull()
  })
})

describe('helpers', () => {
  it('approximates the registrable domain', () => {
    expect(registrableDomain('shop.acme.test')).toBe('acme.test')
    expect(registrableDomain('static.nimbus.co.uk')).toBe('nimbus.co.uk')
    expect(registrableDomain('www.nimbus.com.au')).toBe('nimbus.com.au')
    expect(registrableDomain('nimbus.example')).toBe('nimbus.example')
  })

  it('picks own stylesheets first', () => {
    expect(
      pickStylesheets(
        ['https://cdn.example/x.css', 'https://acme.test/a.css', 'https://img.acme.test/b.css'],
        'https://www.acme.test/',
        2
      )
    ).toEqual(['https://acme.test/a.css', 'https://img.acme.test/b.css'])
  })

  it('never spends a stylesheet on a consent banner', () => {
    expect(
      pickStylesheets(
        [
          'https://cdn.consentkit.example/banner.css',
          'https://acme.test/css/cookie-notice.css',
          'https://acme.test/a.css',
        ],
        'https://www.acme.test/'
      )
    ).toEqual(['https://acme.test/a.css'])
  })

  it('ranks favicons: PNG near 64-192, then SVG, then touch icons, then /favicon.ico', () => {
    expect(
      rankFavicons(
        [
          { url: 'https://acme.test/t.png', size: null, type: null, from: 'apple-touch-icon' },
          { url: 'https://acme.test/i.svg', size: null, type: 'image/svg+xml', from: 'icon' },
          { url: 'https://acme.test/16.png', size: 16, type: 'image/png', from: 'icon' },
          { url: 'https://acme.test/512.png', size: 512, type: 'image/png', from: 'manifest' },
          { url: 'https://acme.test/32.png', size: 32, type: 'image/png', from: 'icon' },
          {
            url: 'https://acme.test/180.png',
            size: 180,
            type: 'image/png',
            from: 'apple-touch-icon',
          },
        ],
        'https://acme.test/'
      )
    ).toEqual([
      'https://acme.test/180.png',
      'https://acme.test/32.png',
      'https://acme.test/512.png',
      'https://acme.test/i.svg',
      'https://acme.test/t.png',
      'https://acme.test/16.png',
      'https://acme.test/favicon.ico',
    ])
  })
})

describe('liveSiteFetcher', () => {
  it('fetches through the redirect-checking fetch under the reader name, with no credentials', async () => {
    fetchFollowingRedirects.mockResolvedValue({
      response: new Response('x'.repeat(100), {
        status: 200,
        headers: { 'content-type': 'text/css' },
      }),
      finalUrl: 'https://www.acme.test/main.css',
    })
    const res = await liveSiteFetcher('https://acme.test/main.css', 'css', {
      maxBytes: 10,
      timeoutMs: 4_000,
    })
    expect(res).toMatchObject({
      status: 200,
      url: 'https://www.acme.test/main.css',
      contentType: 'text/css',
    })
    expect(res?.body.byteLength).toBe(10)
    const [url, opts] = fetchFollowingRedirects.mock.calls[0]
    expect(url).toBe('https://acme.test/main.css')
    expect(opts.allowUrl).toBe(isStandardWebsiteUrl)
    expect(opts).toMatchObject({ timeoutMs: 4_000, maxBytes: 10 })
    expect(opts.headers.accept).toMatch(/text\/css/)
    // It says who it is, under the name robots.txt is matched by, and never poses as a browser.
    expect(opts.headers['user-agent']).toBe(`${READER_TOKEN}/1.0 (+https://quackback.io)`)
    expect(opts.headers['user-agent']).not.toMatch(/Mozilla|Chrome|Safari/)
    expect(Object.keys(opts.headers).map((h) => h.toLowerCase())).not.toContain('cookie')
    expect(Object.keys(opts.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
  })

  it('opens a body a server sent gzipped whatever was asked, within the byte limit', async () => {
    const { gzipSync } = await import('node:zlib')
    const svg = `<svg viewBox="0 0 10 10">${'<path d="M0 0h10v10z"/>'.repeat(40)}</svg>`
    fetchFollowingRedirects.mockResolvedValue({
      response: new Response(gzipSync(svg), {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
      finalUrl: 'https://cdn.acme.test/logo.svg',
    })
    const res = await liveSiteFetcher('https://cdn.acme.test/logo.svg', 'image', {
      maxBytes: 2_000,
      timeoutMs: 1_000,
    })
    expect(new TextDecoder().decode(res?.body)).toBe(svg)
    // One that opens past the limit is refused, not cut short.
    const big = await liveSiteFetcher('https://cdn.acme.test/logo.svg', 'image', {
      maxBytes: 500,
      timeoutMs: 1_000,
    })
    expect(big).toBeNull()
  })

  it('asks for images a logo or icon can be: PNG, WebP or SVG, never AVIF first', async () => {
    fetchFollowingRedirects.mockResolvedValue({
      response: new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }),
      finalUrl: 'https://acme.test/icon.png',
    })
    await liveSiteFetcher('https://acme.test/icon.png', 'image', { maxBytes: 10, timeoutMs: 1 })
    const accept: string = fetchFollowingRedirects.mock.calls.at(-1)![1].headers.accept
    expect(accept).not.toMatch(/avif/)
    expect(accept.startsWith('image/png')).toBe(true)
  })

  it('returns null on any failure', async () => {
    fetchFollowingRedirects.mockResolvedValueOnce(null)
    expect(
      await liveSiteFetcher('https://acme.test/', 'page', { maxBytes: 10, timeoutMs: 1 })
    ).toBeNull()
    fetchFollowingRedirects.mockRejectedValueOnce(new Error('boom'))
    expect(
      await liveSiteFetcher('https://acme.test/', 'page', { maxBytes: 10, timeoutMs: 1 })
    ).toBeNull()
  })
})
