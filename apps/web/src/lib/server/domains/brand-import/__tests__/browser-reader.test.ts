// @vitest-environment node
/**
 * The browser reader client: it asks the sidecar to read a site, retries once
 * when the sidecar is briefly unavailable, gives up quietly on a timeout or any
 * other failure (Import then uses the static read), and trusts nothing it is
 * sent: an SVG logo is sanitised and an image logo fetched and verified, or
 * dropped. The sidecar is a local HTTP server; nothing leaves the machine.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageMeasure } from '../browser/page-measure'
import { browserBrandReader, browserReaderFrom } from '../browser-reader'
import type { SiteFetcher } from '../site/types'
import { ttf, woff2 } from '../site/__tests__/font-fixture'

const TOKEN = 'a-long-enough-token'

const measure: PageMeasure = {
  title: 'Acme',
  themeColor: null,
  bg: 'rgb(255, 255, 255)',
  text: 'rgb(17, 17, 17)',
  bodyFont: '"Acme Sans", sans-serif',
  h1: { font: '"Acme Display", serif' },
  buttons: [{ bg: 'rgb(83, 58, 253)', fg: 'rgb(255, 255, 255)', radius: '4px', h: 40 }],
  logo: null,
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()))
  server = undefined
})

async function sidecar(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => handler(req, res, body))
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`
}

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

const ok = (m: PageMeasure = measure) => ({ ok: true, url: 'https://acme.example/', measure: m })

const noFetch: SiteFetcher = vi.fn(async () => null)

describe('browserBrandReader', () => {
  it('sends the URL with its token and reads the measurements as a BrandRead', async () => {
    const seen: Array<{ auth?: string; body: string; path?: string }> = []
    const url = await sidecar((req, res, body) => {
      seen.push({ auth: req.headers.authorization, body, path: req.url })
      json(res, 200, ok())
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(seen).toEqual([
      {
        auth: `Bearer ${TOKEN}`,
        body: JSON.stringify({ url: 'https://acme.example/' }),
        path: '/read',
      },
    ])
    expect(result).toEqual({
      read: {
        title: 'Acme',
        page: { background: '#ffffff', text: '#111111' },
        button: { fill: '#533afd', ink: '#ffffff', heightPx: 40, radiusPx: 4 },
        fonts: {
          body: { family: 'Acme Sans', stack: '"Acme Sans", sans-serif' },
          headline: { family: 'Acme Display', stack: '"Acme Display", serif' },
        },
      },
    })
  })

  it('reads a page the site walled off as a bot check, not as the brand', async () => {
    const url = await sidecar((_req, res) => json(res, 200, ok({ ...measure, wall: true })))
    const reader = browserBrandReader({ url, token: 'a-long-enough-token', fetcher: noFetch })
    expect(await reader.read('https://acme.example/')).toEqual({ failed: 'challenge' })
  })

  it('tells an error page, a bot check and a country picker from the site’s own page, by the page’s signs', async () => {
    const signs = { status: 200, heading: '', lead: '', words: 4000, links: [] }
    const read = async (page: object, more: object = {}) => {
      const url = await sidecar((_req, res) =>
        json(res, 200, ok({ ...measure, ...more, page: { ...signs, ...page } }))
      )
      return browserBrandReader({ url, token: 'a-long-enough-token', fetcher: noFetch }).read(
        'https://acme.example/'
      )
    }
    // The site's own page reads as before.
    expect(await read({})).toHaveProperty('read')
    // The page's own HTTP status, which only the browser knows.
    expect(await read({ status: 403, words: 14 })).toEqual({ failed: 'error' })
    expect(
      await read({ status: 503, lead: 'Just a moment... verify you are human', words: 40 })
    ).toEqual({
      failed: 'challenge',
    })
    expect(
      await read(
        { lead: 'We are experiencing high demand at the moment.', words: 140 },
        { title: 'Acme - Information Page' }
      )
    ).toEqual({ failed: 'error' })
    // The sidecar's own word for a wall is not believed of a page with the brand on it,
    // and still is of one with nothing on it.
    expect(await read({ words: 214 }, { wall: true })).toHaveProperty('read')
    expect(await read({ words: 900 }, { wall: true, buttons: [], logo: null })).toEqual({
      failed: 'challenge',
    })
    // A splash with nothing of the brand on it.
    expect(await read({ words: 30 }, { buttons: [], logo: null })).toEqual({ failed: 'error' })
    const links = [{ href: 'https://acme.example/ca', text: 'Canada' }]
    expect(await read({ heading: 'Hello! Choose a country.', words: 160, links })).toEqual({
      failed: 'picker',
      links,
      pageUrl: 'https://acme.example/',
    })
  })

  it('hands back the site’s own dark-mode logo, sanitised, with how the page showed it and its inks', async () => {
    const svg = (fill: string) =>
      `<svg viewBox="0 0 9 3" onload="x()"><path d="M0 0h9" fill="${fill}"/></svg>`
    const url = await sidecar((_req, res) =>
      json(
        res,
        200,
        ok({
          ...measure,
          logo: { tag: 'svg', src: null, w: 90, h: 30, svg: svg('rgb(10, 10, 10)') },
          darkLogo: {
            tag: 'svg',
            src: null,
            w: 90,
            h: 30,
            svg: svg('rgb(250, 250, 250)'),
            from: 'scheme',
            inks: [{ color: '#fafafa', share: 1 }],
          },
        })
      )
    )
    const result = await browserBrandReader({
      url,
      token: 'a-long-enough-token',
      fetcher: noFetch,
    }).read('https://acme.example/')
    const read = 'read' in result ? result.read : null
    expect(read?.darkLogo).toMatchObject({
      how: 'scheme',
      widthPx: 90,
      inks: [{ color: '#fafafa', share: 1 }],
    })
    expect(read?.darkLogo?.svg).toContain('250, 250, 250')
    expect(read?.darkLogo?.svg).not.toContain('onload')
  })

  it('reads the richer measure a newer sidecar sends, and the plain one an older sends', async () => {
    const richer = {
      ...measure,
      candidates: [
        {
          bg: 'rgb(8, 135, 43)',
          fg: 'rgb(255, 255, 255)',
          radius: '6px',
          h: 44,
          w: 160,
          top: 300,
          text: 'Sign up',
          header: false,
          overlay: false,
        },
      ],
      textFont: '"Mona Sans", sans-serif',
      textColor: 'rgb(31, 35, 40)',
    }
    const url = await sidecar((_req, res) => json(res, 200, ok(richer)))
    const reader = browserBrandReader({ url, token: 'a-long-enough-token', fetcher: noFetch })
    const result = await reader.read('https://acme.example/')
    expect(result).toMatchObject({
      read: { button: { fill: '#08872b' }, fonts: { body: { family: 'Mona Sans' } } },
    })
  })

  it('fetches the app icon the page declares, for a site that walls off the static reader', async () => {
    const { pngOf } = await import('@/lib/server/content/__tests__/image-fixtures')
    const url = await sidecar((_req, res) =>
      json(
        res,
        200,
        ok({
          ...measure,
          icons: [
            { url: 'https://acme.example/fav-32.png', size: 32, type: 'image/png', from: 'icon' },
            {
              url: 'https://acme.example/touch.png',
              size: 180,
              type: null,
              from: 'apple-touch-icon',
            },
          ],
        })
      )
    )
    const fetcher: SiteFetcher = vi.fn(async (address) =>
      address === 'https://acme.example/touch.png'
        ? { status: 200, url: address, contentType: 'image/png', body: pngOf(180, 180) }
        : null
    )
    const reader = browserBrandReader({ url, token: 'a-long-enough-token', fetcher })
    expect(await reader.read('https://acme.example/')).toMatchObject({
      read: { icon: { widthPx: 180, heightPx: 180, raster: { mime: 'image/png' } } },
    })
  })

  it('takes the logo and icon the browser already loaded, where a fetch of its own meets a bot check', async () => {
    const { pngOf } = await import('@/lib/server/content/__tests__/image-fixtures')
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 34"><path d="M0 0h148v34H0z" fill="#f97316"/></svg>'
    const url = await sidecar((_req, res) =>
      json(
        res,
        200,
        ok({
          ...measure,
          logo: { tag: 'IMG', src: 'https://cdn.acme.example/logo.svg', w: 148, h: 34 },
          icons: [
            {
              url: 'https://acme.example/touch.png',
              size: 180,
              type: null,
              from: 'apple-touch-icon',
            },
          ],
          assets: [
            {
              url: 'https://cdn.acme.example/logo.svg',
              mime: 'image/svg+xml',
              data: Buffer.from(svg).toString('base64'),
            },
            {
              url: 'https://acme.example/touch.png',
              mime: 'image/png',
              data: pngOf(180, 180).toString('base64'),
            },
          ],
        })
      )
    )
    // Every fetch of its own is walled off.
    const wall = {
      status: 403,
      url: '',
      contentType: 'text/html',
      body: new TextEncoder().encode('<title>Just a moment...</title>'),
    }
    const fetcher: SiteFetcher = vi.fn(async (address) => ({ ...wall, url: address }))
    const reader = browserBrandReader({ url, token: 'a-long-enough-token', fetcher })
    const result = await reader.read('https://acme.example/')
    expect(result).toMatchObject({
      read: {
        logo: { svg: expect.stringContaining('#f97316'), from: 'header-img' },
        icon: { widthPx: 180, raster: { mime: 'image/png' } },
      },
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('carries the page palette and the dark read through the reply', async () => {
    const withPalette = {
      ...measure,
      bg: 'rgb(238, 239, 233)',
      surfaces: [
        {
          bg: 'rgb(255, 255, 255)',
          chars: 900,
          rounded: true,
          bordered: false,
          shadowed: false,
          wide: false,
        },
      ],
      texts: [
        { color: 'rgb(17, 17, 17)', chars: 2000 },
        { color: 'rgb(55, 65, 81)', chars: 600 },
      ],
      borders: [{ color: 'rgb(191, 193, 183)', count: 30 }],
      dark: { bg: 'rgb(29, 31, 39)', text: 'rgb(250, 250, 250)' },
      header: { bg: 'rgb(0, 94, 184)', text: 'rgb(255, 255, 255)' },
    }
    const url = await sidecar((_req, res) => json(res, 200, ok(withPalette)))
    const reader = browserBrandReader({ url, token: 'a-long-enough-token', fetcher: noFetch })
    expect(await reader.read('https://acme.example/')).toMatchObject({
      read: {
        page: {
          card: '#ffffff',
          border: '#bfc1b7',
          mutedText: '#374151',
          header: '#005eb8',
          headerText: '#ffffff',
        },
        dark: { page: { background: '#1d1f27', text: '#fafafa' } },
      },
    })
  })

  it.each([502, 503])('retries once on a %s', async (status) => {
    let calls = 0
    const url = await sidecar((_req, res) => {
      calls++
      if (calls === 1) json(res, status, { ok: false })
      else json(res, 200, ok())
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(calls).toBe(2)
    expect('read' in result).toBe(true)
  })

  it('gives up after a second 503', async () => {
    let calls = 0
    const url = await sidecar((_req, res) => {
      calls++
      json(res, 503, { ok: false })
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(calls).toBe(2)
    expect(result).toEqual({ failed: 'unreachable' })
  })

  it.each([400, 401, 500])('does not retry a %s', async (status) => {
    let calls = 0
    const url = await sidecar((_req, res) => {
      calls++
      json(res, status, { ok: false })
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(calls).toBe(1)
    expect(result).toEqual({ failed: 'unreachable' })
  })

  it('gives up when the sidecar takes too long', async () => {
    const url = await sidecar(() => {
      // Never answers.
    })
    const started = Date.now()
    const result = await browserBrandReader({
      url,
      token: TOKEN,
      fetcher: noFetch,
      timeoutMs: 200,
    }).read('https://acme.example/')
    expect(result).toEqual({ failed: 'unreachable' })
    expect(Date.now() - started).toBeLessThan(2_000)
    server?.closeAllConnections()
  })

  it('gives up when nothing listens', async () => {
    const url = await sidecar(() => undefined)
    await new Promise<void>((done) => server!.close(() => done()))
    server = undefined
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(result).toEqual({ failed: 'unreachable' })
  })

  it.each([
    ['a reply that is not JSON', 'not json'],
    ['a reply of the wrong shape', JSON.stringify({ ok: true, measure: { bg: 3 } })],
    ['a failed read', JSON.stringify({ ok: false, reason: 'unreachable' })],
  ])('reads nothing from %s', async (_name, body) => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(result).toEqual({ failed: 'unreachable' })
  })

  describe('the site’s own font', () => {
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const readWith = async (siteFont: PageMeasure['siteFont']) => {
      const url = await sidecar((_req, res) => json(res, 200, ok({ ...measure, siteFont })))
      const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
        'https://acme.example/'
      )
      return 'read' in result ? result.read.siteFont : 'failed'
    }

    it('takes the files the browser loaded, read and classed by their own bytes', async () => {
      const regular = woff2({ family: 'Acme Sans' })
      const bold = woff2({ family: 'Acme Sans', weight: 700 })
      expect(
        await readWith({
          family: 'Acme Sans',
          files: [
            { url: 'https://acme.example/f/r.woff2', weight: 400, data: b64(regular) },
            { url: 'https://acme.example/f/b.woff2', weight: 700, data: b64(bold) },
          ],
        })
      ).toEqual({
        family: 'Acme Sans',
        licence: 'commercial',
        files: [
          { bytes: new Uint8Array(regular), format: 'woff2', weight: 400 },
          { bytes: new Uint8Array(bold), format: 'woff2', weight: 700 },
        ],
      })
      // Nothing was fetched: the bytes are the browser's.
      expect(noFetch).not.toHaveBeenCalled()
    })

    it('names a font service’s font and a restricted one, copying neither', async () => {
      expect(await readWith({ family: 'Acme Sans', service: true, files: [] })).toEqual({
        family: 'Acme Sans',
        notCopied: 'service',
      })
      expect(
        await readWith({
          family: 'Acme Sans',
          files: [
            {
              url: 'https://acme.example/f/r.ttf',
              weight: 400,
              data: b64(ttf({ fsType: 0x0002 })),
            },
          ],
        })
      ).toEqual({ family: 'Acme Sans', notCopied: 'restricted' })
    })

    it('never trusts the sidecar’s word that a file is not a font service’s', async () => {
      expect(
        await readWith({
          family: 'Acme Sans',
          files: [{ url: 'https://use.typekit.net/af/1/l', weight: 400, data: b64(woff2()) }],
        })
      ).toEqual({ family: 'Acme Sans', notCopied: 'service' })
    })

    it('leaves out bytes that are not a font, keeping the rest of the read', async () => {
      expect(
        await readWith({
          family: 'Acme Sans',
          files: [
            {
              url: 'https://acme.example/f/r.woff2',
              weight: 400,
              data: b64(Buffer.from('<html>')),
            },
          ],
        })
      ).toBeUndefined()
    })
  })

  it('reads a reply that carries two font files beside the logo and icons', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...ok(), padding: 'x'.repeat(3 * 1024 * 1024) }))
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect('read' in result).toBe(true)
  })

  it('reads nothing from a reply over the size cap', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...ok(), padding: 'x'.repeat(5 * 1024 * 1024) }))
    })
    const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
      'https://acme.example/'
    )
    expect(result).toEqual({ failed: 'unreachable' })
  })

  describe('logos', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 30"><path fill="currentColor" d="M0 0h90v30H0z"/><script>alert(1)</script></svg>'

    it('sanitises an inline SVG logo and draws it in its own colour', async () => {
      const url = await sidecar((_req, res) =>
        json(
          res,
          200,
          ok({
            ...measure,
            logo: { tag: 'svg', src: null, w: 90, h: 30, svg, color: 'rgb(10, 37, 64)' },
          })
        )
      )
      const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
        'https://acme.example/'
      )
      const logo = 'read' in result ? result.read.logo : undefined
      expect(logo).toMatchObject({ widthPx: 90, heightPx: 30, from: 'header-svg' })
      expect(logo?.svg).not.toContain('script')
      expect(logo?.svg).toContain('#0a2540')
    })

    it('drops an SVG logo the sanitiser refuses, so the static reader’s logo stands', async () => {
      const url = await sidecar((_req, res) =>
        json(
          res,
          200,
          ok({
            ...measure,
            logo: { tag: 'svg', src: null, w: 90, h: 30, svg: '<svg><script/></svg>' },
          })
        )
      )
      const result = await browserBrandReader({ url, token: TOKEN, fetcher: noFetch }).read(
        'https://acme.example/'
      )
      expect('read' in result && 'logo' in result.read).toBe(false)
    })

    // A 1x1 PNG.
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
    )

    it('fetches an image logo through the guarded fetcher and keeps verified bytes', async () => {
      const fetcher: SiteFetcher = vi.fn(async (u: string) => ({
        status: 200,
        url: u,
        contentType: 'image/png',
        body: png,
      }))
      const url = await sidecar((_req, res) =>
        json(
          res,
          200,
          ok({
            ...measure,
            logo: { tag: 'IMG', src: 'https://acme.example/logo.png', w: 120, h: 30 },
          })
        )
      )
      const result = await browserBrandReader({ url, token: TOKEN, fetcher }).read(
        'https://acme.example/'
      )
      expect(fetcher).toHaveBeenCalledWith(
        'https://acme.example/logo.png',
        'image',
        expect.anything()
      )
      expect('read' in result ? result.read.logo : undefined).toEqual({
        raster: { bytes: png, mime: 'image/png' },
        widthPx: 120,
        heightPx: 30,
        from: 'header-img',
      })
    })

    it('drops an image logo whose bytes are not an image', async () => {
      const fetcher: SiteFetcher = vi.fn(async (u: string) => ({
        status: 200,
        url: u,
        contentType: 'image/png',
        body: new TextEncoder().encode('<html>nope</html>'),
      }))
      const url = await sidecar((_req, res) =>
        json(
          res,
          200,
          ok({
            ...measure,
            logo: { tag: 'IMG', src: 'https://acme.example/logo.png', w: 120, h: 30 },
          })
        )
      )
      const result = await browserBrandReader({ url, token: TOKEN, fetcher }).read(
        'https://acme.example/'
      )
      expect('read' in result && 'logo' in result.read).toBe(false)
    })

    it('reads an SVG image logo as sanitised markup', async () => {
      const fetcher: SiteFetcher = vi.fn(async (u: string) => ({
        status: 200,
        url: u,
        contentType: 'image/svg+xml',
        body: new TextEncoder().encode(svg),
      }))
      const url = await sidecar((_req, res) =>
        json(
          res,
          200,
          ok({
            ...measure,
            logo: { tag: 'IMG', src: 'https://acme.example/logo.svg', w: 89, h: 36 },
          })
        )
      )
      const result = await browserBrandReader({ url, token: TOKEN, fetcher }).read(
        'https://acme.example/'
      )
      const logo = 'read' in result ? result.read.logo : undefined
      expect(logo).toMatchObject({ widthPx: 89, heightPx: 36, from: 'header-img' })
      expect(logo?.svg).not.toContain('script')
    })
  })
})

describe('browserReaderFrom', () => {
  it('is off unless both the URL and the token are set', () => {
    expect(browserReaderFrom({})).toBeUndefined()
    expect(browserReaderFrom({ url: 'http://browser:3200' })).toBeUndefined()
    expect(browserReaderFrom({ token: TOKEN })).toBeUndefined()
    expect(browserReaderFrom({ url: 'http://browser:3200', token: TOKEN })?.name).toBe('browser')
  })

  it('stays off, rather than failing imports, for a URL that is not http(s) or a short token', () => {
    expect(browserReaderFrom({ url: 'browser:3200', token: TOKEN })).toBeUndefined()
    expect(browserReaderFrom({ url: 'not a url', token: TOKEN })).toBeUndefined()
    expect(browserReaderFrom({ url: 'http://browser:3200', token: 'short' })).toBeUndefined()
  })
})
