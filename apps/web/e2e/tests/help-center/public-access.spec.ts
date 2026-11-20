/**
 * Who sees what on the public help center: hidden content, segment gates on
 * articles and categories, and the counts on the landing page.
 *
 * Journeys: HC-P-04, HC-P-14, HC-P-16, HC-A-22, HC-A-35.
 */
import type { Browser, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mintCustomer, portalPage } from '../../support/widget-portal'
import {
  articlePath,
  collectionPath,
  gateToSegments,
  hcApi,
  hcArticle,
  hcCategory,
  hcSegment,
} from '../../product/help-center'

const FRESH = { headers: { cookie: 'e2e=1' }, maxRedirects: 0 }

/** A signed-in portal customer of this test, optionally in a segment of its own. */
async function member(browser: Browser, marker: string, email: string, inSegment: boolean) {
  const customer = await mintCustomer({ email })
  const segment = await hcSegment(marker, inSegment ? [customer.principalUuid] : [])
  const page = await portalPage(browser, customer)
  return { customer, segment, page }
}

async function statusFor(page: Page, path: string) {
  return (await page.request.get(path, { maxRedirects: 0 })).status()
}

test(
  'HC-P-14 hidden articles and collections are the same 404 as a missing page',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const open = await hcCategory(hc, `Open ${marker}`)
    const closed = await hcCategory(hc, `Closed ${marker}`, { isPublic: false })
    const draft = await hcArticle(hc, { categoryId: open.id, title: `Draft ${marker}` })
    const deleted = await hcArticle(hc, {
      categoryId: open.id,
      title: `Deleted ${marker}`,
      publish: true,
    })
    await hc.delete(`/api/v1/help-center/articles/${deleted.id}`)
    const privateDoc = await hcArticle(hc, {
      categoryId: closed.id,
      title: `Private ${marker}`,
      publish: true,
    })
    const gated = await hcArticle(hc, {
      categoryId: open.id,
      title: `Gated ${marker}`,
      publish: true,
    })
    await gateToSegments({ kind: 'article', uuid: gated.uuid }, [(await hcSegment(marker)).id])
    await hcArticle(hc, { categoryId: open.id, title: `Visible ${marker}`, publish: true })

    const missing = await request.get('/hc/en/articles/987654321-missing', FRESH)
    expect(missing.status()).toBe(404)
    const missingTitle = (await missing.text()).match(/<title>([^<]*)<\/title>/)?.[1]
    for (const a of [draft, deleted, privateDoc, gated]) {
      const res = await request.get(articlePath(a), FRESH)
      const html = await res.text()
      expect(res.status(), a.title).toBe(404)
      // The URL (and so the slug) is echoed back; the title and body are not.
      expect(html, a.title).not.toContain(a.title)
      expect(html, a.title).not.toContain(`Body of ${a.title}`)
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1], a.title).toBe(missingTitle)
    }
    const closedPage = await request.get(collectionPath(closed), FRESH)
    expect(closedPage.status()).toBe(404)
    expect(await closedPage.text()).not.toContain(closed.name)
  }
)

test(
  'HC-A-35 a segment-gated category is open only to signed-in members of the segment',
  { tag: '@core' },
  async ({ browser, asPerson, request, marker, playwright, customerEmail }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Members ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Members only ${marker}`,
      publish: true,
    })
    const inside = await member(browser, marker, customerEmail, true)
    const outside = await member(browser, `${marker}-o`, `out-${customerEmail}`, false)
    await gateToSegments({ kind: 'category', uuid: category.uuid }, [inside.segment.id])

    expect((await request.get(collectionPath(category), FRESH)).status()).toBe(404)
    expect((await request.get(articlePath(article), FRESH)).status()).toBe(404)
    expect(await statusFor(outside.page, articlePath(article))).toBe(404)

    await inside.page.goto(collectionPath(category))
    await expect(inside.page.getByRole('heading', { level: 1, name: category.name })).toBeVisible()
    await inside.page.goto(articlePath(article))
    await expect(inside.page.getByRole('heading', { level: 1, name: article.title })).toBeVisible()

    // Team members bypass the segment gate.
    const admin = await asPerson('admin')
    expect(await statusFor(admin, articlePath(article))).toBe(200)
  }
)

test(
  'HC-A-22 an article restricted to a segment is hidden from everyone else, its category stays open',
  { tag: '@core' },
  async ({ browser, request, marker, playwright, customerEmail }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Audience ${marker}`)
    const restricted = await hcArticle(hc, {
      categoryId: category.id,
      title: `Restricted ${marker}`,
      publish: true,
    })
    const open = await hcArticle(hc, {
      categoryId: category.id,
      title: `Everyone ${marker}`,
      publish: true,
    })
    const inside = await member(browser, marker, customerEmail, true)
    await gateToSegments({ kind: 'article', uuid: restricted.uuid }, [inside.segment.id])

    expect((await request.get(articlePath(restricted), FRESH)).status()).toBe(404)
    const collection = await request.get(collectionPath(category), FRESH)
    expect(collection.status()).toBe(200)
    const html = await collection.text()
    expect(html).toContain(open.title)
    expect(html).not.toContain(restricted.title)

    await inside.page.goto(collectionPath(category))
    await expect(
      inside.page.getByRole('link', { name: new RegExp(restricted.title) })
    ).toBeVisible()
    expect(await statusFor(inside.page, articlePath(restricted))).toBe(200)
  }
)

test(
  'HC-P-16 a gated article is left out of the landing, collection, related and prev/next lists',
  { tag: '@core' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Lists ${marker}`)
    const first = await hcArticle(hc, {
      categoryId: category.id,
      title: `First ${marker}`,
      publish: true,
    })
    const gated = await hcArticle(hc, {
      categoryId: category.id,
      title: `Hidden ${marker}`,
      publish: true,
    })
    const last = await hcArticle(hc, {
      categoryId: category.id,
      title: `Last ${marker}`,
      publish: true,
    })
    await gateToSegments({ kind: 'article', uuid: gated.uuid }, [(await hcSegment(marker)).id])

    for (const path of [articlePath(first), articlePath(last), collectionPath(category), '/hc']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(gated.title), path).toHaveCount(0)
      expect(await page.content(), path).not.toContain(gated.title)
    }
  }
)

test(
  'HC-P-04 the landing card counts only articles the visitor can open',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'HC-B14: listPublicCategories rolls recursivePublishedArticleCount up through private and gated descendants and article audiences',
    },
  },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const parent = await hcCategory(hc, `Counted ${marker}`)
    await hcArticle(hc, { categoryId: parent.id, title: `Open doc ${marker}`, publish: true })
    const hidden = await hcCategory(hc, `Hidden child ${marker}`, {
      parentId: parent.id,
      isPublic: false,
    })
    for (let i = 0; i < 3; i++) {
      await hcArticle(hc, { categoryId: hidden.id, title: `Hidden ${i} ${marker}`, publish: true })
    }
    const gated = await hcArticle(hc, {
      categoryId: parent.id,
      title: `Gated ${marker}`,
      publish: true,
    })
    await gateToSegments({ kind: 'article', uuid: gated.uuid }, [(await hcSegment(marker)).id])
    expect(
      (
        await supportDb()`SELECT count(*)::int AS n FROM kb_articles WHERE title LIKE ${`%${marker}`}`
      )[0].n
    ).toBe(5)

    await page.goto('/hc')
    const card = page
      .getByRole('region', { name: 'Browse by topic' })
      .getByRole('link')
      .filter({ hasText: parent.name })
    await expect(card).toBeVisible()
    await expect(card).toContainText('1 article')
    await expect(card).not.toContainText(/[2-9] articles/)
  }
)
