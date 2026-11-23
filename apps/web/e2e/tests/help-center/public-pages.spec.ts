/**
 * The public help center: landing, collection and article pages, canonical
 * and legacy URLs, and view counts.
 *
 * Journeys: HC-P-02, HC-P-03, HC-P-05, HC-P-07, HC-P-11, HC-P-12, HC-P-33.
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { SUPPORT_PEOPLE } from '../../support/people'
import {
  articlePath,
  articleRow,
  collectionPath,
  hcApi,
  hcArticle,
  hcCategory,
} from '../../product/help-center'

/** A request with a cookie: the app skips the shared-cache path for it. */
const FRESH = { headers: { cookie: 'e2e=1' }, maxRedirects: 0 }

test(
  'HC-P-07 a signed-out visitor reads an article with its author, body and feedback card',
  { tag: '@smoke' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Read ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Reading ${marker}`,
      description: `What this covers ${marker}`,
      content: `## First step\n\nDo the first thing ${marker}.\n\n## Second step\n\nThen the next.`,
      publish: true,
    })
    const res = await page.goto(articlePath(article))
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: article.title })).toBeVisible()
    await expect(page.getByText(`What this covers ${marker}`).first()).toBeVisible()
    await expect(page.getByText(SUPPORT_PEOPLE.admin.name).first()).toBeVisible()
    await expect(page.getByText(/Last updated/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'First step' })).toBeVisible()
    await expect(page.getByText(`Do the first thing ${marker}.`)).toBeVisible()
    await expect(page.getByText('Was this helpful?')).toBeVisible()
    // Counters are not in the public payload.
    expect(await page.content()).not.toMatch(/helpfulCount|notHelpfulCount/)
  }
)

test(
  'HC-P-02 the landing lists a public category as a card linking to its collection',
  { tag: '@core' },
  async ({ page, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Topic ${marker}`, {
      description: `About the topic ${marker}`,
    })
    await hcArticle(hc, { categoryId: category.id, title: `One ${marker}`, publish: true })
    await hcArticle(hc, { categoryId: category.id, title: `Two ${marker}`, publish: true })

    await page.goto('/hc')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('searchbox').or(page.getByRole('textbox')).first()).toBeVisible()
    const card = page
      .getByRole('region', { name: 'Browse by topic' })
      .getByRole('link')
      .filter({ hasText: category.name })
    await expect(card).toHaveAttribute('href', collectionPath(category))
    await expect(card).toContainText(`About the topic ${marker}`)
    await expect(card).toContainText('2 articles')
    expect(await page.title()).toMatch(/ - /)

    // A cookie-less request is cacheable by a shared cache.
    const anon = await request.get('/hc', { headers: { cookie: '' } })
    expect(anon.headers()['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=600')
  }
)

test(
  'HC-P-03 the landing shows only live public categories with a published article',
  { tag: '@core' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const shown = await hcCategory(hc, `Shown ${marker}`)
    await hcArticle(hc, { categoryId: shown.id, title: `Shown doc ${marker}`, publish: true })
    const empty = await hcCategory(hc, `Empty ${marker}`)
    const drafts = await hcCategory(hc, `Drafts only ${marker}`)
    await hcArticle(hc, { categoryId: drafts.id, title: `Draft doc ${marker}` })
    const hidden = await hcCategory(hc, `Private ${marker}`, { isPublic: false })
    await hcArticle(hc, { categoryId: hidden.id, title: `Private doc ${marker}`, publish: true })
    const parent = await hcCategory(hc, `Parent ${marker}`)
    const child = await hcCategory(hc, `Child ${marker}`, { parentId: parent.id })
    await hcArticle(hc, { categoryId: child.id, title: `Child doc ${marker}`, publish: true })
    const future = await hcCategory(hc, `Future ${marker}`)
    const later = await hcArticle(hc, {
      categoryId: future.id,
      title: `Later ${marker}`,
      publish: true,
    })
    await supportDb()`UPDATE kb_articles SET published_at = NOW() + interval '1 day'
      WHERE id = ${later.uuid}`

    await page.goto('/hc')
    const card = (name: string) =>
      page
        .getByRole('region', { name: 'Browse by topic' })
        .getByRole('link')
        .filter({ hasText: name })
    await expect(card(shown.name)).toBeVisible()
    // A parent is a card because of its child's article; the child is not.
    await expect(card(parent.name)).toBeVisible()
    for (const c of [empty, drafts, hidden, child, future]) {
      await expect(card(c.name), c.name).toHaveCount(0)
    }
  }
)

test(
  'HC-P-05 a collection page shows its own articles and its sub-categories',
  { tag: '@core' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Collection ${marker}`, {
      description: `Collection about ${marker}`,
    })
    const own = await hcArticle(hc, {
      categoryId: category.id,
      title: `Own ${marker}`,
      description: `Own summary ${marker}`,
      publish: true,
    })
    const sub = await hcCategory(hc, `Sub ${marker}`, { parentId: category.id })
    const subTitles: string[] = []
    for (let i = 1; i <= 9; i++) {
      const a = await hcArticle(hc, {
        categoryId: sub.id,
        title: `Sub item ${i} ${marker}`,
        publish: true,
      })
      subTitles.push(a.title)
    }
    const emptySub = await hcCategory(hc, `Empty sub ${marker}`, { parentId: category.id })

    await page.goto(collectionPath(category))
    await expect(page.getByRole('heading', { level: 1, name: category.name })).toBeVisible()
    await expect(page.getByText(`Collection about ${marker}`).first()).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(own.title) })).toBeVisible()
    await expect(page.getByText(`Own summary ${marker}`)).toBeVisible()
    await expect(page.getByText(/1 min read/).first()).toBeVisible()
    // The sub-category section shows its first 8 and a link to the rest.
    await expect(page.getByRole('heading', { name: sub.name })).toBeVisible()
    let visible = 0
    for (const t of subTitles) visible += await page.getByRole('link', { name: t }).count()
    expect(visible).toBe(8)
    await expect(page.getByRole('link', { name: 'View all 9 articles' })).toHaveAttribute(
      'href',
      collectionPath(sub)
    )
    // An empty sub-category says so (it may be left out of the page instead).
    expect(await page.getByRole('heading', { name: emptySub.name }).count()).toBeLessThanOrEqual(1)
  }
)

test(
  'HC-P-11 the numeric id is the key: a wrong slug or a bare id 301s to the canonical URL',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Canon ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Canonical ${marker}`,
      publish: true,
    })
    const canonical = articlePath(article)
    const ok = await request.get(canonical, FRESH)
    expect(ok.status()).toBe(200)
    const html = await ok.text()
    expect(html).toContain(`rel="canonical" href="`)
    expect(html).toMatch(new RegExp(`rel="canonical" href="[^"]*${canonical}"`))

    for (const variant of [
      `/hc/en/articles/${article.urlId}-wrong-slug`,
      `/hc/en/articles/${article.urlId}`,
    ]) {
      const res = await request.get(variant, FRESH)
      expect(res.status(), variant).toBe(301)
      expect(new URL(res.headers()['location'], 'http://x').pathname).toBe(canonical)
    }
    expect((await request.get('/hc/en/articles/not-a-number', FRESH)).status()).toBe(404)
    expect((await request.get('/hc/en/articles/999999999-nope', FRESH)).status()).toBe(404)

    // A slug change keeps old links working.
    await hc.patch(`/api/v1/help-center/articles/${article.id}`, {
      data: { slug: `renamed-${marker}` },
    })
    const old = await request.get(canonical, FRESH)
    expect(old.status()).toBe(301)
    expect(new URL(old.headers()['location'], 'http://x').pathname).toBe(
      `/hc/en/articles/${article.urlId}-renamed-${marker}`
    )
  }
)

test(
  'HC-P-12 legacy article, category and /help URLs redirect to the canonical form',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Legacy ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Legacy doc ${marker}`,
      publish: true,
    })
    const hop = async (path: string) => {
      const res = await request.get(path, FRESH)
      expect(res.status(), path).toBe(301)
      return new URL(res.headers()['location'], 'http://x').pathname
    }
    /** Follow 301s to the end. */
    const settle = async (path: string) => {
      let current = path
      for (let i = 0; i < 5; i++) {
        const res = await request.get(current, FRESH)
        if (res.status() !== 301) return { path: current, status: res.status() }
        current = new URL(res.headers()['location'], 'http://x').pathname
      }
      throw new Error(`redirect loop from ${path}`)
    }

    expect(await hop(`/hc/articles/${category.slug}/${article.slug}`)).toBe(articlePath(article))
    // Only the article slug is checked, not the category segment.
    expect(await hop(`/hc/articles/anything/${article.slug}`)).toBe(articlePath(article))
    expect(await settle(`/hc/${category.slug}/${article.slug}`)).toEqual({
      path: articlePath(article),
      status: 200,
    })
    expect(await settle(`/hc/categories/${category.slug}`)).toEqual({
      path: collectionPath(category),
      status: 200,
    })
    // `/hc/<slug>` (one segment) is left out: it 404s today, and which route
    // should win there (language, legacy category, redirect rule) is an
    // open owner question.
    const help = await request.get('/help', FRESH)
    expect([301, 302, 307, 308]).toContain(help.status())
    expect(new URL(help.headers()['location'], 'http://x').pathname).toBe('/hc')
    expect((await settle(`/hc/articles/${category.slug}/no-such-${marker}`)).status).toBe(404)
  }
)

test(
  'HC-P-33 reading the canonical article page counts a view',
  {
    tag: '@core',
  },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Views ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Viewed ${marker}`,
      publish: true,
    })
    expect((await articleRow(article.uuid))?.view_count).toBe(0)
    await page.goto(articlePath(article))
    await expect(page.getByRole('heading', { level: 1, name: article.title })).toBeVisible()
    await expect.poll(async () => (await articleRow(article.uuid))?.view_count).toBe(1)
  }
)
