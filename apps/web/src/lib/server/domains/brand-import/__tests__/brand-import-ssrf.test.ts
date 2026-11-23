/**
 * Import over the live fetcher: every request, the page's own stylesheet and
 * logo links and every redirect hop included, goes through the SSRF guard,
 * and an address the guard refuses is never reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seams = vi.hoisted(() => ({
  requested: [] as string[],
  routes: {} as Record<string, () => Response>,
}))

vi.mock('@/lib/server/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: { child: () => log } }
})
vi.mock('@/lib/server/utils/rate-bucket', () => ({ incrementBuckets: async () => [1, 1] }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => false,
  generateStorageKey: () => 'unused',
  uploadObject: vi.fn(),
}))
vi.mock('@/lib/server/content/ssrf-guard', async (original) => {
  const actual = await original<typeof import('@/lib/server/content/ssrf-guard')>()
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string) => {
      seams.requested.push(url)
      // The guard's own verdict, as its DNS check would give it.
      if (new URL(url).hostname.startsWith('internal.')) throw new actual.SsrfError('ssrf-rejected')
      const route = seams.routes[url]
      if (!route) return new Response('not found', { status: 404 })
      return route()
    }),
  }
})

const { importBrand } = await import('../brand-import.service')

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })

beforeEach(() => {
  seams.requested.length = 0
  seams.routes = {}
})

describe('importBrand over the live fetcher', () => {
  it('sends the page, its stylesheets and its logo through the guard, and skips what it refuses', async () => {
    seams.routes = {
      'https://acme.example/': () =>
        html(`<html><head><meta name="theme-color" content="#1f4d3a">
          <link rel="stylesheet" href="https://internal.acme.example/secret.css">
          <link rel="stylesheet" href="/main.css"></head>
          <body><header><a href="/"><img src="https://internal.acme.example/logo.png" alt="Acme"></a></header></body></html>`),
      'https://acme.example/main.css': () =>
        new Response('body{font-family:Lato,sans-serif}', {
          status: 200,
          headers: { 'content-type': 'text/css' },
        }),
    }
    const result = await importBrand('acme.example')

    expect(result).toMatchObject({ primary: '#1f4d3a', font: { id: 'lato', exact: true } })
    expect(seams.requested).toEqual(
      expect.arrayContaining([
        'https://acme.example/robots.txt',
        'https://acme.example/',
        'https://internal.acme.example/secret.css',
        'https://acme.example/main.css',
        'https://internal.acme.example/logo.png',
      ])
    )
  })

  it('stops at a redirect to an address the guard refuses', async () => {
    seams.routes = {
      'https://acme.example/': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://internal.acme.example/' },
        }),
    }
    await expect(importBrand('acme.example')).rejects.toMatchObject({ code: 'SITE_UNREACHABLE' })
    expect(seams.requested).toContain('https://internal.acme.example/')
  })

  it('never follows a redirect to another port or to credentials', async () => {
    seams.routes = {
      'https://acme.example/': () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://admin:pw@acme.example:8080/' },
        }),
    }
    await expect(importBrand('acme.example')).rejects.toMatchObject({ code: 'SITE_UNREACHABLE' })
    expect(seams.requested).not.toContain('https://admin:pw@acme.example:8080/')
  })
})
