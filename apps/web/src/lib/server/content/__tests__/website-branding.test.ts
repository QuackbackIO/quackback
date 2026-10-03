// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

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
  addresses: new Map<string, { address: string; family: number }[]>(),
  requests: [] as {
    hostname: string
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
    if (/^\d+(?:\.\d+){3}$/.test(host)) return [{ address: host, family: 4 }]
    const addresses = fixture.addresses.get(host)
    if (!addresses) throw new Error('No DNS fixture for ' + host)
    return addresses
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16])
const page = (head: string) =>
  fixture.routes.set('example.com/', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<head>' + head + '</head>',
  })
const image = (path: string, body: Buffer = PNG, mime = 'image/png') =>
  fixture.routes.set('example.com' + path, { headers: { 'content-type': mime }, body })
beforeEach(() => {
  fixture.routes.clear()
  fixture.addresses.clear()
  fixture.addresses.set('example.com', [{ address: '93.184.216.34', family: 4 }])
  fixture.addresses.set('assets.example.com', [{ address: '93.184.216.34', family: 4 }])
  fixture.requests.length = 0
  fixture.uploads.length = 0
  fixture.storage = true
  fixture.clock = null
})
afterEach(() => vi.restoreAllMocks())
describe('website branding through real safe-fetch and magic-byte seams', () => {
  it('fetches the homepage, prefers a touch icon and rehosts without requiring a title', async () => {
    page(
      '<link rel="apple-touch-icon" href="/brand.png"><meta property="og:image" content="/banner.png"><meta name="theme-color" content="#8fbc8f">'
    )
    image('/brand.png')
    image('/banner.png')
    const result = await fetchWebsiteBranding('https://example.com/docs')
    expect(result).toEqual({
      domain: 'example.com',
      logoKey: 'logos/' + createHash('sha256').update(PNG).digest('hex') + '.png',
      logoUrl: '/api/storage/logos/' + createHash('sha256').update(PNG).digest('hex') + '.png',
      color: '#8FBC8F',
    })
    expect(fixture.uploads).toHaveLength(1)
    expect(fixture.uploads[0].buffer).toEqual(PNG)
    expect(fixture.requests.map((entry) => entry.path)).toEqual(['/', '/brand.png'])
    expect(
      fixture.requests.every(
        (entry) => entry.hostname === '93.184.216.34' && entry.servername === 'example.com'
      )
    ).toBe(true)
  })
  it('supports the conventional verified ICO fallback and canonical MIME alias', async () => {
    page('')
    image('/favicon.ico', ICO, 'image/vnd.microsoft.icon')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: expect.stringMatching(/^logos\/.+\.x-icon$/),
      color: null,
    })
    expect(fixture.uploads[0].mime).toBe('image/x-icon')
  })
  it('falls back to a verified OG image when an icon cannot be fetched', async () => {
    page('<link rel="icon" href="/missing.png"><meta property="og:image" content="/banner.png">')
    image('/banner.png')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: expect.stringMatching(/^logos\//),
    })
    expect(fixture.uploads).toHaveLength(1)
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
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests).toHaveLength(0)
    expect(fixture.uploads).toHaveLength(0)
  })
  it('refuses an image redirect to a private address', async () => {
    page('<link rel="icon" href="/brand.png">')
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: 'http://169.254.169.254/metadata' },
    })
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.requests.some((entry) => entry.headers.host === '169.254.169.254')).toBe(false)
    expect(fixture.uploads).toHaveLength(0)
  })
  it.each([
    ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/png', Buffer.from('GIF89a123456')],
    ['text/html', PNG],
    ['image/png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])],
  ])('refuses untrusted or oversized image bytes declared as %s', async (mime, bytes) => {
    page('<link rel="icon" href="/brand.png">')
    image('/brand.png', bytes, mime)
    expect(await fetchWebsiteBranding('example.com')).toBeNull()
    expect(fixture.uploads).toHaveLength(0)
  })
  it('revalidates each allowed image redirect and never falls back to global fetch', async () => {
    const unsafeFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected direct fetch'))
    page('<link rel="icon" href="/brand.png">')
    fixture.routes.set('example.com/brand.png', {
      status: 302,
      headers: { location: 'https://assets.example.com/logo.png' },
    })
    fixture.routes.set('assets.example.com/logo.png', {
      headers: { 'content-type': 'image/png' },
      body: PNG,
    })
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({
      logoKey: expect.stringMatching(/^logos\//),
    })
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
    image('/next.png')
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
  it('keeps a logo but skips a color that fails contrast against default ink', async () => {
    page('<meta name="theme-color" content="#0F766E">')
    image('/favicon.ico', ICO, 'image/x-icon')
    expect(await fetchWebsiteBranding('example.com')).toMatchObject({ color: null })
  })
  it('returns no branding when storage is unavailable instead of a hotlink', async () => {
    page('<link rel="icon" href="/brand.png">')
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
