// @vitest-environment node
/**
 * Import with the browser sidecar configured: robots.txt is honoured before
 * the sidecar is asked, the browser's measurements win when it answers, and a
 * sidecar that stalls or fails leaves Import with the static read.
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchedBody, SiteFetcher } from '../site/types'

vi.mock('@/lib/server/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: { child: () => log } }
})
vi.mock('@/lib/server/utils/rate-bucket', () => ({ incrementBuckets: vi.fn(async () => [1, 1]) }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => false,
  generateStorageKey: vi.fn(),
  uploadObject: vi.fn(),
}))

const { importBrand } = await import('../brand-import.service')
const { browserBrandReader } = await import('../browser-reader')

const ok = (body: string, contentType: string): FetchedBody => ({
  status: 200,
  url: '',
  contentType,
  body: new TextEncoder().encode(body),
})
const HOME = `<!doctype html><html><head><title>Acme</title>
  <style>body{font-family:"Acme Sans",sans-serif} .btn{background:#c2410c}</style>
</head><body><h1>Parcels</h1></body></html>`

function web(robots = 'User-agent: *\nDisallow: /admin\n'): SiteFetcher {
  const routes: Record<string, FetchedBody> = {
    'https://acme.example/robots.txt': ok(robots, 'text/plain'),
    'https://acme.example/': ok(HOME, 'text/html'),
  }
  return async (url) => (routes[url] ? { ...routes[url]!, url } : null)
}

const MEASURE = {
  title: 'Acme',
  themeColor: null,
  bg: 'rgb(8, 9, 10)',
  text: 'rgb(247, 248, 248)',
  bodyFont: 'Inter, sans-serif',
  h1: null,
  buttons: [{ bg: 'rgb(83, 58, 253)', fg: 'rgb(255, 255, 255)', radius: '9999px', h: 32 }],
  logo: null,
}

let server: Server | undefined
let calls = 0
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()))
  server = undefined
  calls = 0
})

async function sidecar(answer: 'measure' | 'stall' | 'fail'): Promise<string> {
  server = createServer((req, res) => {
    calls++
    req.resume()
    if (answer === 'stall') return
    res.writeHead(answer === 'fail' ? 500 : 200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(answer === 'fail' ? { ok: false } : { ok: true, url: 'x', measure: MEASURE })
    )
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`
}

describe('importBrand with the browser sidecar', () => {
  it('uses the browser’s measurements when the sidecar answers', async () => {
    const url = await sidecar('measure')
    const browser = browserBrandReader({ url, token: 'a-long-enough-token', fetcher: web() })
    const result = await importBrand('acme.example', { fetcher: web(), browser })
    expect(result).toMatchObject({
      reader: 'browser',
      primary: '#533afd',
      background: '#08090a',
      scheme: 'dark',
      buttonShape: 'pill',
    })
  })

  it.each(['stall', 'fail'] as const)(
    'falls back to the static read when the sidecar %ss',
    async (answer) => {
      const url = await sidecar(answer)
      const browser = browserBrandReader({
        url,
        token: 'a-long-enough-token',
        fetcher: web(),
        timeoutMs: 200,
      })
      const result = await importBrand('acme.example', { fetcher: web(), browser })
      expect(result.reader).toBe('static')
      expect(result.primary).toBe('#c2410c')
    }
  )

  it('never asks the sidecar for a site whose robots.txt refuses the reader', async () => {
    const url = await sidecar('measure')
    const browser = browserBrandReader({ url, token: 'a-long-enough-token', fetcher: web() })
    await expect(
      importBrand('acme.example', {
        fetcher: web('User-agent: QuackbackBrandReader\nDisallow: /\n'),
        browser,
      })
    ).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' })
    expect(calls).toBe(0)
  })
})
