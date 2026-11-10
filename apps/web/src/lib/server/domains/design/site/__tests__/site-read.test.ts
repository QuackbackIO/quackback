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
import {
  liveSiteFetcher,
  pickStylesheets,
  rankFavicons,
  readSite,
  registrableDomain,
} from '../site-read'

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
  <meta name="theme-color" content="#ff6600">
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
        ':root{--brand:#ff6600} .font-body{font-family:Inter,sans-serif}'
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
      'https://acme.test/share.png': image(pngOf(1200, 630)),
    })
    const read = await readSite('acme.test', fetcher, { logoInk: '#111111', now: () => 0 })
    expect(read.failed).toBeNull()
    expect(read.facts).toMatchObject({
      url: 'https://acme.test/',
      name: 'Acme Parcel',
      themeColour: '#ff6600',
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
      ['image', 'https://acme.test/share.png'],
    ])
    expect(calls[0]).toMatchObject({ maxBytes: 1_000_000, timeoutMs: 15_000 })
    expect(logs.info).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'acme.test', stylesheets: 1 }),
      'site read'
    )
  })

  it('reads at most four stylesheets, the site’s own first, parsed in document order', async () => {
    const links = [
      'https://cdn.other.example/a.css',
      '/b.css',
      'https://static.acme.test/c.css',
      '/d.css',
      '/e.css',
      'https://cdn.other.example/f.css',
    ]
    const page = `<html><head>${links.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head><body></body></html>`
    const routes: Record<string, Route> = { 'https://acme.test/': html(page) }
    for (const name of ['b', 'd', 'e'])
      routes[`https://acme.test/${name}.css`] = css(`body{font-family:Face${name}}`)
    routes['https://static.acme.test/c.css'] = css('body{font-family:Facec}')
    const { fetcher, calls } = fakeFetcher(routes)
    const read = await readSite('https://acme.test', fetcher)
    expect(calls.filter((c) => c.kind === 'css').map((c) => c.url)).toEqual([
      'https://acme.test/b.css',
      'https://static.acme.test/c.css',
      'https://acme.test/d.css',
      'https://acme.test/e.css',
    ])
    expect(read.facts?.stylesheets).toEqual([
      'https://acme.test/b.css',
      'https://static.acme.test/c.css',
      'https://acme.test/d.css',
      'https://acme.test/e.css',
    ])
    expect(read.facts?.fonts.body?.family).toBe('Facee')
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

  it('fails a page that cannot be fetched or errors', async () => {
    expect((await readSite('acme.test', fakeFetcher({}).fetcher)).failed).toBe('fetch_failed')
    const { fetcher } = fakeFetcher({
      'https://acme.test/': { ...html('<p>Server error</p>'), status: 500 },
    })
    expect((await readSite('acme.test', fetcher)).failed).toBe('fetch_failed')
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
  it('fetches through the redirect-checking fetch with browser-like headers and no credentials', async () => {
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
    expect(opts.headers['user-agent']).toMatch(/Mozilla/)
    expect(Object.keys(opts.headers).map((h) => h.toLowerCase())).not.toContain('cookie')
    expect(Object.keys(opts.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
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
