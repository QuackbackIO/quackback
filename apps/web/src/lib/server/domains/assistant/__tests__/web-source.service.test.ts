/**
 * Real-DB coverage for the web-source service and retrieval source: adding a
 * public URL crawls it through the (mocked) SSRF-guarded fetch, extracts the
 * page's title + text, and stores the row; retrieval then grounds a query on
 * the crawled content and cites the original URL. The edge cases are the
 * fetch boundary itself: an SSRF rejection (private/loopback target) must
 * propagate and store nothing, and a non-HTML / error response must be
 * rejected rather than stored as grounding content.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { assistantWebSources } from '@/lib/server/db'
import { SsrfError } from '@/lib/server/content/ssrf-guard'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockSafeFetch = vi.fn()
vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

import {
  addWebSourceFromUrl,
  extractLinks,
  matchesPathFilters,
  listWebSources,
  setWebSourceEnabled,
  deleteWebSource,
} from '../web-source.service'
import { webpageKnowledgeSource } from '../web-sources-retrieval'
import { retrieveKnowledge } from '../retrieval-sources'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantWebSources.id }).from(assistantWebSources).limit(0)
  },
})

const PAGE_URL = 'https://docs.example.com/billing'

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  })
}

const BILLING_PAGE = `<!doctype html>
<html><head><title>Billing &amp; Invoices</title><style>body{color:red}</style></head>
<body><nav>Home | Docs</nav><script>track()</script>
<main><h1>Billing</h1>
<p>Invoices are issued on the first of each month. You can update your billing
email under Settings &gt; Workspace. Annual plans receive two months free.</p>
</main></body></html>`

describe.skipIf(!fixture.available)('web-source service + retrieval (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('crawls an admin-added URL and stores the extracted title + text', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(BILLING_PAGE))

    const source = await addWebSourceFromUrl({ url: PAGE_URL })

    expect(mockSafeFetch).toHaveBeenCalledWith(PAGE_URL, expect.objectContaining({ method: 'GET' }))
    expect(source.url).toBe(PAGE_URL)
    expect(source.title).toBe('Billing & Invoices')
    expect(source.enabled).toBe(true)
    // Markup, scripts, and styles are gone; the prose survives.
    expect(source.content).toContain('Invoices are issued on the first of each month')
    expect(source.content).not.toContain('track()')
    expect(source.content).not.toContain('color:red')
    expect(source.content).not.toContain('<')

    const rows = await listWebSources()
    expect(rows.map((r) => r.id)).toEqual([source.id])
  })

  it('grounds a customer question on the crawled content and cites the page URL', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(BILLING_PAGE))
    await addWebSourceFromUrl({ url: PAGE_URL })

    const items = await retrieveKnowledge('when are invoices issued', 'public', {
      enabledSources: new Set(['webpage']),
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sourceType: 'webpage',
      title: 'Billing & Invoices',
      citation: { type: 'webpage', url: PAGE_URL },
    })
    expect(items[0].citation).not.toHaveProperty('internal')
    expect(items[0].excerpt).toContain('first of each month')
  })

  it('excludes disabled sources from retrieval', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(BILLING_PAGE))
    const source = await addWebSourceFromUrl({ url: PAGE_URL })
    await setWebSourceEnabled(source.id, false)

    const items = await webpageKnowledgeSource.retrieve('invoices', 'public', { topK: 5 })
    expect(items).toEqual([])
  })

  it('deleteWebSource removes the row', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(BILLING_PAGE))
    const source = await addWebSourceFromUrl({ url: PAGE_URL })
    await deleteWebSource(source.id)
    expect(await listWebSources()).toEqual([])
  })

  it('edge case: an SSRF-rejected URL (private/loopback target) stores nothing', async () => {
    mockSafeFetch.mockRejectedValue(new SsrfError('ssrf-rejected'))

    await expect(
      addWebSourceFromUrl({ url: 'http://169.254.169.254/latest/meta-data' })
    ).rejects.toThrow(SsrfError)
    expect(await listWebSources()).toEqual([])
  })

  it('edge case: a non-HTML response is rejected, not stored as grounding content', async () => {
    mockSafeFetch.mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    )

    await expect(addWebSourceFromUrl({ url: 'https://example.com/api.json' })).rejects.toThrow(
      /HTML/i
    )
    expect(await listWebSources()).toEqual([])
  })

  it('edge case: an error status is rejected', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse('not found', { status: 404 }))

    await expect(addWebSourceFromUrl({ url: 'https://example.com/missing' })).rejects.toThrow(/404/)
    expect(await listWebSources()).toEqual([])
  })

  describe('crawl mode', () => {
    /** A fake site: url -> html body; links drive the crawl. */
    function fakeSite(pages: Record<string, string | Response>) {
      mockSafeFetch.mockImplementation(async (url: string) => {
        const page = pages[url]
        if (page === undefined) {
          return htmlResponse('not found', { status: 404 })
        }
        return page instanceof Response ? page : htmlResponse(page)
      })
    }

    const page = (title: string, body: string, links: string[] = []) =>
      `<!doctype html><html><head><title>${title}</title></head><body><p>${body}</p>${links
        .map((href) => `<a href="${href}">link</a>`)
        .join('')}</body></html>`

    it('ingests same-origin pages linked from the seed URL', async () => {
      fakeSite({
        'https://docs.example.com/': page('Docs home', 'Welcome to the docs.', [
          '/billing',
          '/quickstart',
          'https://other.example.com/external',
        ]),
        'https://docs.example.com/billing': page('Billing', 'Invoices are issued monthly.', [
          'https://docs.example.com/refunds#section',
        ]),
        'https://docs.example.com/quickstart': page('Quickstart', 'Install the snippet.'),
        'https://docs.example.com/refunds': page('Refunds', 'Refunds take five days.'),
      })

      const root = await addWebSourceFromUrl({ url: 'https://docs.example.com/', crawl: true })

      expect(root.url).toBe('https://docs.example.com/')
      const urls = (await listWebSources()).map((r) => r.url)
      expect(urls).toHaveLength(4)
      expect(urls).toContain('https://docs.example.com/billing')
      expect(urls).toContain('https://docs.example.com/quickstart')
      // Hash-only suffix does not produce a second page for the same target.
      expect(urls.filter((u) => u.startsWith('https://docs.example.com/refunds'))).toHaveLength(1)
      // Cross-origin link was never fetched.
      expect(mockSafeFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('other.example.com'),
        expect.anything()
      )
    })

    it('caps the number of ingested pages per source', async () => {
      const pages: Record<string, string> = {
        'https://docs.example.com/': page('Home', 'root', ['/p1', '/p2', '/p3']),
      }
      for (const n of [1, 2, 3]) {
        pages[`https://docs.example.com/p${n}`] = page(`P${n}`, `page ${n}`)
      }
      fakeSite(pages)

      await addWebSourceFromUrl({ url: 'https://docs.example.com/', crawl: true, maxPages: 2 })

      expect(await listWebSources()).toHaveLength(2)
      expect(mockSafeFetch).toHaveBeenCalledTimes(2)
    })

    it('honors admin include/exclude path filters on discovered links', async () => {
      fakeSite({
        'https://docs.example.com/': page('Home', 'root', [
          '/docs/a',
          '/docs/internal/draft',
          '/blog/post',
        ]),
        'https://docs.example.com/docs/a': page('A', 'public doc a'),
        'https://docs.example.com/docs/internal/draft': page('Draft', 'unpublished draft'),
        'https://docs.example.com/blog/post': page('Post', 'a blog post'),
      })

      await addWebSourceFromUrl({
        url: 'https://docs.example.com/',
        crawl: true,
        includePaths: ['/docs/*'],
        excludePaths: ['/docs/internal/*'],
      })

      const urls = (await listWebSources()).map((r) => r.url)
      expect(urls).toContain('https://docs.example.com/docs/a')
      expect(urls).not.toContain('https://docs.example.com/docs/internal/draft')
      expect(urls).not.toContain('https://docs.example.com/blog/post')
      expect(mockSafeFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/docs/internal'),
        expect.anything()
      )
    })

    it('edge case: a broken page mid-crawl is skipped and the crawl continues', async () => {
      fakeSite({
        'https://docs.example.com/': page('Home', 'root', ['/gone', '/fine']),
        'https://docs.example.com/fine': page('Fine', 'this page works'),
      })

      const root = await addWebSourceFromUrl({ url: 'https://docs.example.com/', crawl: true })

      expect(root.url).toBe('https://docs.example.com/')
      const urls = (await listWebSources()).map((r) => r.url)
      expect(urls).toEqual(
        expect.arrayContaining(['https://docs.example.com/', 'https://docs.example.com/fine'])
      )
      expect(urls).toHaveLength(2)
    })

    it('edge case: an already-stored page is not duplicated on re-crawl', async () => {
      fakeSite({
        'https://docs.example.com/': page('Home', 'root', ['/a']),
        'https://docs.example.com/a': page('A', 'page a', ['/']),
      })

      await addWebSourceFromUrl({ url: 'https://docs.example.com/', crawl: true })
      await addWebSourceFromUrl({ url: 'https://docs.example.com/', crawl: true })

      expect(await listWebSources()).toHaveLength(2)
    })
  })

  describe('pure helpers', () => {
    it('extractLinks resolves relative hrefs and drops non-http schemes', () => {
      const links = extractLinks(
        `<a href="/a">a</a><a href="b">b</a><a href="mailto:x@y.z">m</a><a href="#frag">f</a>`,
        'https://docs.example.com/dir/'
      )
      expect(links).toContain('https://docs.example.com/a')
      expect(links).toContain('https://docs.example.com/dir/b')
      expect(links).not.toContain('mailto:x@y.z')
      // Same-page fragment resolves to the page itself, hash stripped.
      expect(links).toContain('https://docs.example.com/dir/')
    })

    it('matchesPathFilters applies include-then-exclude glob semantics', () => {
      expect(matchesPathFilters('/docs/a', ['/docs/*'], [])).toBe(true)
      expect(matchesPathFilters('/blog/a', ['/docs/*'], [])).toBe(false)
      expect(matchesPathFilters('/docs/internal/x', ['/docs/*'], ['/docs/internal/*'])).toBe(false)
      expect(matchesPathFilters('/anything', [], [])).toBe(true)
      expect(matchesPathFilters('/exact', ['/exact'], [])).toBe(true)
    })
  })
})
