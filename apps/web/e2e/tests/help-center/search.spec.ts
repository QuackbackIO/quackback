/**
 * Help center search: the hero search on /hc and the kb-search endpoint it
 * calls.
 *
 * Journeys: HC-S-01, HC-S-02, HC-S-04.
 *
 * The fake AI's embeddings are hash vectors, so only the keyword arm can
 * match: every article carries a unique `searchWord()` in its title.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { clientIp } from '../../support/api-client'
import { supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import {
  articlePath,
  gateToSegments,
  hcApi,
  hcArticle,
  hcCategory,
  hcSegment,
  searchWord,
} from '../../product/help-center'

interface Hit {
  id: string
  title: string
}

/** kb-search as a signed-out visitor from an address of its own. */
async function kbSearch(request: APIRequestContext, q: string): Promise<Hit[]> {
  const res = await request.get(`/api/widget/kb-search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-e2e-client-ip': clientIp() },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { data: { articles: Hit[] } }).data.articles
}

test(
  'HC-S-01 the hero search finds a published article by a title word and opens it',
  { tag: '@smoke' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const category = await hcCategory(hc, `Search ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Configuring the ${word} relay`,
      content: `Turn the relay on. ${marker}`,
      publish: true,
    })
    await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': clientIp() })
    await page.goto('/hc')
    const box = page.locator('#hc-search')
    await waitForHydration(box)
    const searched = page.waitForResponse((r) => r.url().includes('/api/widget/kb-search'))
    await box.fill(word)
    const res = await searched
    expect(new URL(res.url()).searchParams.get('limit')).toBe('8')
    const result = page.getByRole('button').filter({ hasText: article.title })
    await expect(result).toBeVisible()
    await expect(result).toContainText(category.name)
    await result.click()
    await expect(page).toHaveURL(new RegExp(`${articlePath(article)}$`))
    await expect(page.getByRole('heading', { level: 1, name: article.title })).toBeVisible()
  }
)

test(
  'HC-S-02 a title word matches, stopwords alone do not, and matching ignores case and stems',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const category = await hcCategory(hc, `Match ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Exporting ${word} reports`,
      publish: true,
    })
    const ids = async (q: string) => (await kbSearch(request, q)).map((h) => h.title)

    expect(await ids(word)).toEqual([article.title])
    expect(await ids(word.toUpperCase())).toEqual([article.title])
    // Any one word of several can match (an OR of terms).
    expect(await ids(`${word} ${searchWord()}`)).toEqual([article.title])
    // "how do I" is all stopwords: an empty query, no results.
    expect(await kbSearch(request, 'how do I')).toEqual([])
    // A word in no article finds nothing.
    expect(await kbSearch(request, searchWord())).toEqual([])
  }
)

test(
  'HC-S-04 search never returns drafts, deleted, private, gated or future articles',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const open = await hcCategory(hc, `Open ${marker}`)
    const closed = await hcCategory(hc, `Closed ${marker}`, { isPublic: false })
    const make = (title: string, categoryId = open.id, publish = true) =>
      hcArticle(hc, { categoryId, title: `${title} ${word}`, publish })

    const visible = await make('Visible')
    await make('Draft', open.id, false)
    const deleted = await make('Deleted')
    await hc.delete(`/api/v1/help-center/articles/${deleted.id}`)
    await make('Private', closed.id)
    const gated = await make('Gated')
    await gateToSegments({ kind: 'article', uuid: gated.uuid }, [(await hcSegment(marker)).id])
    const future = await make('Future')
    await supportDb()`UPDATE kb_articles SET published_at = NOW() + interval '1 day'
      WHERE id = ${future.uuid}`
    const unpublished = await make('Unpublished')
    await hc.patch(`/api/v1/help-center/articles/${unpublished.id}`, {
      data: { publishedAt: null },
    })

    expect((await kbSearch(request, word)).map((h) => h.title)).toEqual([visible.title])
  }
)
