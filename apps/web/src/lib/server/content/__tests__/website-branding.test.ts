// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { icoOf, pngOf } from './image-fixtures'

type DnsAnswer = { address: string; family: number }[]
const fixture = vi.hoisted(() => ({
  routes: new Map<
    string,
    {
      status?: number
      headers?: Record<string, string>
      body?: Buffer | string
      advanceMs?: number
    }
  >(),
  /** Answers per host, consumed in order; the last answer repeats. */
  addresses: new Map<string, { address: string; family: number }[][]>(),
  lookups: [] as string[],
  requests: [] as {
    hostname: string
    port: number
    servername?: string
    path: string
    headers: Record<string, string>
    timeout: number
  }[],
  uploads: [] as { key: string; buffer: Buffer; mime: string; prefix: string }[],
  storage: true,
  clock: null as number | null,
}))
vi.mock('node:dns/promises', () => ({
  default: {},
  lookup: async (host: string, options: { all?: boolean }) => {
    if (!options.all) throw new Error('Expected all DNS answers')
    fixture.lookups.push(host)
    if (/^\d+(?:\.\d+){3}$/.test(host)) return [{ address: host, family: 4 }]
    const answers = fixture.addresses.get(host)
    if (!answers?.length) throw new Error('No DNS fixture for ' + host)
    return answers.length > 1 ? answers.shift()! : answers[0]
  },
}))
vi.mock('node:https', () => ({
  default: {},
  request: (
    options: Parameters<typeof requestFromFixture>[0],
    cb: Parameters<typeof requestFromFixture>[1]
  ) => requestFromFixture(options, cb),
}))
vi.mock('node:http', () => ({
  default: {},
  request: (
    options: Parameters<typeof requestFromFixture>[0],
    cb: Parameters<typeof requestFromFixture>[1]
  ) => requestFromFixture(options, cb),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  uploadImageBuffer: async (
    buffer: Buffer,
    mime: string,
    prefix: string,
    opts: { contentAddressed?: boolean }
  ) => {
    if (!fixture.storage) throw new Error('Storage unavailable')
    if (prefix !== 'logos' || !opts.contentAddressed || !buffer.length)
      throw new Error('Unexpected upload contract')
    const key =
      prefix + '/' + createHash('sha256').update(buffer).digest('hex') + '.' + mime.split('/')[1]
    fixture.uploads.push({ key, buffer: Buffer.from(buffer), mime, prefix })
    return { key, url: '/api/storage/' + key }
  },
}))
function requestFromFixture(
  options: (typeof fixture.requests)[number],
  cb: (response: unknown) => void
) {
  fixture.requests.push(options)
  const spec = fixture.routes.get(options.headers.host + options.path) ?? { status: 404 }
  if (fixture.clock !== null) fixture.clock += spec.advanceMs ?? 0
  const request = new EventEmitter() as EventEmitter & {
    end: () => void
    write: () => void
    destroy: (error?: unknown) => void
  }
  request.write = () => {}
  request.destroy = (error) => {
    if (error) request.emit('error', error)
  }
  request.end = () => {
    let destroyed = false
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number
      headers: Record<string, string>
      destroy: () => void
    }
    response.statusCode = spec.status ?? 200
    response.headers = spec.headers ?? {}
    response.destroy = () => {
      destroyed = true
    }
    cb(response)
    queueMicrotask(() => {
      if (spec.body && !destroyed) response.emit('data', Buffer.from(spec.body))
      if (!destroyed) response.emit('end')
    })
  }
  return request
}
import { fetchWebsiteBranding } from '../website-branding'
import { rehostImageFromUrl } from '../unfurl'
const LOGO = pngOf(180, 180)
const ICO = icoOf(16, 32)
const keyFor = (bytes: Buffer, ext: string) =>
  'logos/' + createHash('sha256').update(bytes).digest('hex') + '.' + ext
const page = (head: string) =>
  fixture.routes.set('example.com/', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<head>' + head + '</head>',
  })
const image = (path: string, body: Buffer = LOGO, mime = 'image/png') =>
  fixture.routes.set('example.com' + path, { headers: { 'content-type': mime }, body })
const paths = () => fixture.requests.map((entry) => entry.path)
const answer = (address: string, family = 4): DnsAnswer => [{ address, family }]
beforeEach(() => {
  fixture.routes.clear()
  fixture.addresses.clear()
  fixture.addresses.set('example.com', [answer('93.184.216.34')])
  fixture.addresses.set('assets.example.com', [answer('93.184.216.34')])
  fixture.lookups.length = 0
  fixture.requests.length = 0
  fixture.uploads.length = 0
  fixture.storage = true
  fixture.clock = null
})
afterEach(() => vi.restoreAllMocks())

describe('website branding through real safe-fetch and magic-byte seams', () => {
  it('applies a large touch icon as a good logo and rehosts only that image', async () => {
    page(
      '<link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel="apple-touch-icon" href="/brand.png"><meta property="og:image" content="/banner.png"><meta name="theme-color" content="#0f766e">'
    )
    image('/brand.png')
    image('/favicon-16.png', pngOf(16, 16))
    image('/banner.png', pngOf(1200, 630))
    expect(await fetchWebsiteBranding('https://example.com/docs')).toEqual({
      domain: 'example.com',
      logoKey: keyFor(LOGO, 'png'),
      logoUrl: '/api/storage/' + keyFor(LOGO, 'png'),
      quality: 'good',
      color: '#0F766E',
    })
    expect(fixture.uploads.map((upload) => upload.buffer)).toEqual([LOGO])
    expect(paths()).toEqual(['/', '/brand.png'])
    expect(
      fixture.requests.every(
        (entry) => entry.hostname === '93.184.216.34' && entry.servername === 'example.com'
      )
    ).toBe(true)
  })

  it('sends the page user agent and an image Accept header on image requests', async () => {
    page('<link rel="apple-touch-icon" href="/brand.png">')
    image('/brand.png')
    await fetchWebsiteBranding('example.com')
    const [pageRequest, imageRequest] = fixture.requests
    expect(imageRequest.path).toBe('/brand.png')
    expect(imageRequest.headers.accept).toBe('image/*')
    expect(imageRequest.headers['user-agent']).toMatch(/\S/)
    expect(imageRequest.headers['user-agent']).toBe(pageRequest.headers['user-agent'])
  })

  it('offers a conventional ICO as a weak logo after looking for a touch icon', async () => {
    page('')
    image('/favicon.ico', ICO, 'image/vnd.microsoft.icon')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: keyFor(ICO, 'x-icon'),
      quality: 'weak',
      color: null,
    })
    expect(paths()).toEqual(['/', '/apple-touch-icon.png', '/favicon.ico'])
    expect(fixture.uploads[0].mime).toBe('image/x-icon')
  })

  it('offers a small icon as weak when nothing larger exists', async () => {
    page('<link rel="icon" href="/favicon-32.png" sizes="32x32">')
    image('/favicon-32.png', pngOf(32, 32))
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: keyFor(pngOf(32, 32), 'png'),
      quality: 'weak',
    })
  })

  it('offers a social banner as weak when no icon can be fetched', async () => {
    page('<link rel="icon" href="/missing.png"><meta property="og:image" content="/banner.png">')
    const banner = pngOf(1200, 630)
    image('/banner.png', banner)
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: keyFor(banner, 'png'),
      quality: 'weak',
    })
    expect(fixture.uploads).toHaveLength(1)
  })

  it('keeps looking past a weak icon and uploads only the later good one', async () => {
    page('<link rel="icon" href="/declared.png" sizes="192x192" type="image/png">')
    image('/declared.png', pngOf(32, 32))
    image('/apple-touch-icon.png')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: keyFor(LOGO, 'png'),
      quality: 'good',
    })
    expect(paths()).toEqual(['/', '/declared.png', '/apple-touch-icon.png'])
    expect(fixture.uploads.map((upload) => upload.buffer)).toEqual([LOGO])
  })

  it('never fetches a declared SVG icon', async () => {
    page('<link rel="icon" href="/brand.svg" type="image/svg+xml"><link rel="icon" href="/b.svg">')
    image('/favicon.ico', ICO, 'image/x-icon')
    await fetchWebsiteBranding('example.com')
    expect(paths()).toEqual(['/', '/apple-touch-icon.png', '/favicon.ico'])
  })

  it('skips images wider or taller than 4096 pixels', async () => {
    page('<link rel="apple-touch-icon" href="/huge.png"><link rel="icon" href="/tall.png">')
    image('/huge.png', pngOf(4097, 512))
    image('/tall.png', pngOf(512, 5000))
    image('/favicon.ico', ICO, 'image/x-icon')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: keyFor(ICO, 'x-icon'),
      quality: 'weak',
    })
    expect(fixture.uploads).toHaveLength(1)
    page('<link rel="apple-touch-icon" href="/edge.png">')
    image('/edge.png', pngOf(4096, 4096))
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({ quality: 'good' })
  })

  it('refuses private page redirects and every private DNS answer before connecting', async () => {
    fixture.routes.set('example.com/', {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests).toHaveLength(1)
    fixture.requests.length = 0
    fixture.addresses.set('example.com', [
      [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    ])
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests).toHaveLength(0)
    expect(fixture.uploads).toHaveLength(0)
  })

  it.each([
    '::1',
    'fd12:3456::1',
    'fe80::1',
    'fec0::1',
    '::ffff:10.0.0.1',
    '::7f00:1',
    '::10.0.0.1',
    '64:ff9b::a00:1',
  ])('refuses the private IPv6 answer %s before connecting', async (address) => {
    fixture.addresses.set('example.com', [answer(address, 6)])
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests).toHaveLength(0)
  })

  it('refuses a DNS answer that turns private between redirect hops', async () => {
    fixture.routes.set('example.com/', { status: 301, headers: { location: '/home' } })
    fixture.addresses.set('example.com', [answer('93.184.216.34'), answer('10.0.0.7')])
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.lookups).toEqual(['example.com', 'example.com'])
    expect(fixture.requests.map((entry) => entry.hostname)).toEqual(['93.184.216.34'])
    fixture.requests.length = 0
    fixture.addresses.set('example.com', [answer('93.184.216.34')])
    fixture.addresses.set('www.example.com', [answer('192.168.1.20')])
    fixture.routes.set('example.com/', {
      status: 302,
      headers: { location: 'https://www.example.com/' },
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests.map((entry) => entry.hostname)).toEqual(['93.184.216.34'])
  })

  it('refuses an image redirect to a private address', async () => {
    page('<link rel="apple-touch-icon" href="/brand.png">')
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: 'http://169.254.169.254/metadata' },
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests.some((entry) => entry.headers.host === '169.254.169.254')).toBe(false)
    expect(fixture.uploads).toHaveLength(0)
  })

  it('allows only ports 80 and 443 for the site and every page or image redirect', async () => {
    for (const site of ['https://example.com:8443', 'example.com:8080', 'http://example.com:22'])
      expect(await fetchWebsiteBranding(site)).toBeNull()
    expect(fixture.requests).toHaveLength(0)
    fixture.routes.set('example.com/', {
      status: 302,
      headers: { location: 'https://example.com:8443/' },
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests.map((entry) => entry.port)).toEqual([443])
    fixture.requests.length = 0
    page('<link rel="apple-touch-icon" href="/brand.png">')
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: 'https://assets.example.com:8080/logo.png' },
    })
    fixture.routes.set('assets.example.com:8080/logo.png', {
      headers: { 'content-type': 'image/png' },
      body: LOGO,
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests.length).toBeGreaterThan(1)
    expect(fixture.requests.every((entry) => entry.port === 443)).toBe(true)
    fixture.requests.length = 0
    fixture.routes.set('example.com/', {
      status: 302,
      headers: { location: 'http://example.com:443/' },
    })
    fixture.routes.set('example.com:443/', {
      headers: { 'content-type': 'text/html' },
      body: '<head></head>',
    })
    await fetchWebsiteBranding('https://example.com:443')
    expect(fixture.requests.map((entry) => entry.port).slice(0, 3)).toEqual([443, 443, 443])
  })

  it.each([
    ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/png', Buffer.from('GIF89a123456')],
    ['text/html', LOGO],
    ['image/png', Buffer.concat([LOGO, Buffer.alloc(5 * 1024 * 1024)])],
  ])('refuses untrusted or oversized image bytes declared as %s', async (mime, bytes) => {
    page('<link rel="apple-touch-icon" href="/brand.png">')
    image('/brand.png', bytes, mime)
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.uploads).toHaveLength(0)
  })

  it('revalidates each allowed image redirect and never falls back to global fetch', async () => {
    const unsafeFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected direct fetch'))
    page('<link rel="apple-touch-icon" href="/brand.png">')
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: 'https://assets.example.com/logo.png' },
    })
    fixture.routes.set('assets.example.com/logo.png', {
      headers: { 'content-type': 'image/png' },
      body: LOGO,
    })
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({ quality: 'good' })
    expect(fixture.requests.map((entry) => entry.headers.host)).toEqual([
      'example.com',
      'example.com',
      'assets.example.com',
    ])
    expect(unsafeFetch).not.toHaveBeenCalled()
  })

  it('retains the aggregate byte budget and deadline across image redirects', async () => {
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: '/next.png' },
      body: '12345678',
    })
    image('/next.png', pngOf(1, 1).subarray(0, 11))
    expect(
      await rehostImageFromUrl('https://example.com/brand.png', {
        timeoutMs: 100,
        maxBytes: 15,
        storagePrefix: 'logos',
        followRedirects: true,
      })
    ).toBeNull()
    fixture.requests.length = 0
    fixture.clock = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => fixture.clock!)
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: '/next.png' },
      advanceMs: 110,
    })
    expect(
      await rehostImageFromUrl('https://example.com/brand.png', {
        timeoutMs: 100,
        maxBytes: 100,
        storagePrefix: 'logos',
        followRedirects: true,
      })
    ).toBeNull()
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.uploads).toHaveLength(0)
  })

  it('keeps a logo but skips a white theme color', async () => {
    page('<meta name="theme-color" content="#FAFAFA">')
    image('/favicon.ico', ICO, 'image/x-icon')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({ color: null })
  })

  it('returns no branding when storage is unavailable instead of a hotlink', async () => {
    page('<link rel="apple-touch-icon" href="/brand.png">')
    image('/brand.png')
    fixture.storage = false
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.uploads).toHaveLength(0)
  })

  it('rejects malformed schemes and embedded credentials without any fetch', async () => {
    for (const site of [
      '',
      'file:///etc/passwd',
      'ftp://example.com',
      'https://you:secret@example.com',
      'https://127.0.0.1',
    ])
      expect(await fetchWebsiteBranding(site)).toBeNull()
    expect(fixture.requests).toHaveLength(0)
  })
})
