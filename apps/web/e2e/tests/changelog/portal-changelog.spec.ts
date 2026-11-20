/**
 * The public changelog on the portal: the list, an entry's page, linked
 * posts, view counts, who may read what (label segment gates, audience,
 * private portal), and the sitemap.
 *
 * Journeys: CHG-P-01, CHG-P-06, CHG-P-07, CHG-P-10, CHG-P-11, CHG-P-12
 * (@isolated), CHG-P-13 (@isolated), CHG-P-14 (@isolated, quarantined),
 * CHG-P-15, CHG-P-17 (quarantined), CHG-P-19, CHG-P-20, CHG-P-26.
 *
 * Entries are published silently (notify: false) so no subscriber mail.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { withSettings } from '../../support/isolated-settings'
import { callServerFn, personApi } from '../../support/server-fns'
import { mintCustomer, portalContext, portalPage } from '../../support/widget-portal'
import {
  adminRest,
  createEntry,
  createLabel,
  entryRow,
  retireChangelog,
  segmentWith,
  shippedPost,
  updateEntry,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

/** Ids on the first page of the public list as `api` reads it. */
async function listedIds(api: APIRequestContext): Promise<string[]> {
  const res = await callServerFn<{ items: Array<{ id: string }> }>(
    api,
    'listPublicChangelogsFn',
    { limit: 50 },
    { method: 'GET' }
  )
  expect(res.ok, res.error).toBe(true)
  return res.data.items.map((i) => i.id)
}

async function detail(api: APIRequestContext, id: string) {
  return callServerFn<{ id: string; title: string }>(
    api,
    'getPublicChangelogFn',
    { id },
    { method: 'GET' }
  )
}

/** The feedback list's status filter for a shipped post (the list hides shipped ones by default). */
function shipped(post: { statusSlug: string }): string {
  return encodeURIComponent(JSON.stringify([post.statusSlug]))
}

function card(page: Page, title: string) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

test(
  'CHG-P-15 a label segment gate hides an entry from non-members on the list and its page; members and the team see it',
  { tag: '@smoke' },
  async ({ page, browser, playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const outsider = await mintCustomer({ email: `${marker}-out@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const label = await createLabel(admin, `${marker.slice(-30)} vip`, [segment])
    const gated = await createEntry(admin, {
      title: `${marker} gated`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
    })
    const open = await createEntry(admin, {
      title: `${marker} open`,
      state: 'published',
      notify: false,
    })

    // Anonymous: the list has the open entry only; the gated page is not found.
    await page.goto('/changelog')
    await expect(card(page, open.title)).toBeVisible()
    await expect(card(page, gated.title)).toHaveCount(0)
    await page.goto(`/changelog/${gated.id}`)
    await expect(page.getByText('Changelog entry not found')).toBeVisible()

    const outsiderCtx = await portalContext(browser, outsider)
    expect(await listedIds(outsiderCtx.request)).not.toContain(gated.id)
    expect((await detail(outsiderCtx.request, gated.id)).code).toBe('CHANGELOG_NOT_FOUND')
    await outsiderCtx.close()

    const memberPage = await portalPage(browser, member)
    await memberPage.goto(`/changelog/${gated.id}`)
    await expect(memberPage.getByRole('heading', { name: gated.title, level: 1 })).toBeVisible()
    expect(await listedIds(memberPage.request)).toContain(gated.id)
    await memberPage.context().close()

    expect(await listedIds(admin)).toContain(gated.id)
    await admin.dispose()
  }
)

test(
  'CHG-P-01 the portal list shows published entries newest first with date, label, body and linked posts',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const post = await shippedPost(rest, marker)
    await rest.dispose()
    const label = await createLabel(admin, `${marker.slice(-30)} new`)
    const older = await createEntry(admin, {
      title: `${marker} older`,
      state: 'published',
      notify: false,
    })
    const newer = await createEntry(admin, {
      title: `${marker} newer`,
      content: `${marker} what changed in this release.`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
      linkedPostIds: [post.id],
    })

    await page.goto('/changelog')
    const newerCard = card(page, newer.title)
    await expect(newerCard).toBeVisible()
    await expect(newerCard).toContainText(label.name)
    await expect(newerCard).toContainText(`${marker} what changed in this release.`)
    await expect(newerCard.getByRole('link', { name: new RegExp(post.title) })).toBeVisible()
    const dateLabel = new Date(newer.publishedAt!).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    await expect(newerCard).toContainText(dateLabel)
    await expect(newerCard.getByRole('link', { name: newer.title })).toHaveAttribute(
      'href',
      `/changelog/${newer.id}`
    )
    // Newest first.
    const titles = await page.locator('article h2').allTextContents()
    expect(titles.indexOf(newer.title)).toBeGreaterThanOrEqual(0)
    expect(titles.indexOf(newer.title)).toBeLessThan(titles.indexOf(older.title))
    await admin.dispose()
  }
)

test(
  'CHG-P-06 an entry page: title, label, hero image, body and Shipped Features',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const post = await shippedPost(rest, marker)
    await rest.dispose()
    const label = await createLabel(admin, `${marker.slice(-30)} fix`)
    const image = `${supportEnv().baseUrl}/logo.png`
    const entry = await createEntry(admin, {
      title: `${marker} detail`,
      content: `${marker} the entry body.`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
      linkedPostIds: [post.id],
      featuredImageUrl: image,
    })

    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByRole('heading', { name: entry.title, level: 1 })).toBeVisible()
    await expect(page.getByText(label.name, { exact: true })).toBeVisible()
    await expect(page.getByText(`${marker} the entry body.`)).toBeVisible()
    await expect(page.locator(`img[src*="logo.png"]`).first()).toBeVisible()
    await expect(page.getByText('Shipped Features')).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(post.title) })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Changelog' }).first()).toHaveAttribute(
      'href',
      '/changelog'
    )
    await admin.dispose()
  }
)

test(
  'CHG-P-07 drafts, scheduled, deleted and unknown ids all show the same not-found page',
  { tag: '@core' },
  async ({ page, playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const draft = await createEntry(admin, { title: `${marker} draft` })
    const scheduled = await createEntry(admin, {
      title: `${marker} scheduled`,
      state: { type: 'scheduled', publishAt: new Date(Date.now() + 86_400_000).toISOString() },
    })
    const deleted = await createEntry(admin, {
      title: `${marker} deleted`,
      state: 'published',
      notify: false,
    })
    expect((await callServerFn(admin, 'deleteChangelogFn', { id: deleted.id })).ok).toBe(true)
    const live = await createEntry(admin, {
      title: `${marker} live`,
      state: 'published',
      notify: false,
    })

    for (const id of [
      draft.id,
      scheduled.id,
      deleted.id,
      'changelog_00000000000000000000000000',
      'nonsense',
    ]) {
      await page.goto(`/changelog/${id}`)
      await expect(page.getByText('Changelog entry not found'), id).toBeVisible()
    }
    // Control: a live entry renders.
    await page.goto(`/changelog/${live.id}`)
    await expect(page.getByRole('heading', { name: live.title, level: 1 })).toBeVisible()
    await admin.dispose()
  }
)

test(
  'CHG-P-10 a linked-post card links to the post and shows its live votes and status',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const post = await shippedPost(rest, marker)
    await rest.dispose()
    const entry = await createEntry(admin, {
      title: `${marker} linked`,
      state: 'published',
      notify: false,
      linkedPostIds: [post.id],
    })
    await supportDb()`UPDATE posts SET vote_count = 42 WHERE id = ${toUuid(post.id as `post_${string}`)}`

    await page.goto(`/changelog/${entry.id}`)
    const link = page.getByRole('link', { name: new RegExp(post.title) })
    await expect(link).toHaveAttribute('href', `/b/${post.boardSlug}/posts/${post.id}`)
    await expect(link).toContainText('42')
    await expect(link).toContainText(post.statusName)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/posts/${post.id}$`))
    await admin.dispose()
  }
)

test(
  'CHG-P-11 each public page load counts one view; a denied read counts none',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} views`,
      state: 'published',
      notify: false,
    })
    const draft = await createEntry(admin, { title: `${marker} draft views` })
    const views = async (id: string) => Number((await entryRow(id)).view_count)

    expect(await views(entry.id)).toBe(0)
    expect((await detail(request, entry.id)).ok).toBe(true)
    await expect.poll(() => views(entry.id)).toBe(1)
    expect((await detail(request, entry.id)).ok).toBe(true)
    await expect.poll(() => views(entry.id)).toBe(2)
    expect((await detail(request, draft.id)).code).toBe('CHANGELOG_NOT_FOUND')
    // A later read of the live one lands; the draft's never did.
    expect((await detail(request, entry.id)).ok).toBe(true)
    await expect.poll(() => views(entry.id)).toBe(3)
    expect(await views(draft.id)).toBe(0)
    await admin.dispose()
  }
)

test(
  'CHG-P-12 audience "signed-in people": anonymous readers get nothing; customers and the team read it',
  { tag: ['@core', '@isolated'] },
  async ({ browser, playwright, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} members`,
      state: 'published',
      notify: false,
    })
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const ctx = await portalContext(browser, customer)
    await withSettings({ metadata: { 'changelogSettings.audience': 'public' } }, async () => {
      expect(await listedIds(anonymous)).toContain(entry.id)
    })
    await withSettings(
      { metadata: { 'changelogSettings.audience': 'authenticated' } },
      async () => {
        expect(await listedIds(anonymous)).toEqual([])
        expect((await detail(anonymous, entry.id)).ok).toBe(false)
        expect(await listedIds(ctx.request)).toContain(entry.id)
        expect((await detail(ctx.request, entry.id)).ok).toBe(true)
        expect(await listedIds(admin)).toContain(entry.id)
      }
    )
    await ctx.close()
    await anonymous.dispose()
    await admin.dispose()
  }
)

test(
  'CHG-P-13 a private portal returns no changelog list or entry to a signed-out reader',
  { tag: ['@core', '@isolated'] },
  async ({ playwright, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} private`,
      state: 'published',
      notify: false,
    })
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    await withSettings({ portal_config: { 'access.visibility': 'public' } }, async () => {
      expect(await listedIds(anonymous)).toContain(entry.id)
    })
    await withSettings({ portal_config: { 'access.visibility': 'private' } }, async () => {
      expect(await listedIds(anonymous)).toEqual([])
      expect((await detail(anonymous, entry.id)).ok).toBe(false)
    })
    await anonymous.dispose()
    await admin.dispose()
  }
)

test(
  'CHG-P-14 with the Changelog product off its public server functions answer nothing',
  {
    tag: ['@nightly', '@isolated', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'functions/changelog.ts public reads skip the changelog product flag that routes, feed and widget honour (see QUARANTINE.md)',
    },
  },
  async ({ page, playwright, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} product off`,
      state: 'published',
      notify: false,
    })
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    await withSettings({ feature_flags: { changelog: false } }, async () => {
      const res = await page.goto('/changelog')
      expect(res?.status()).toBe(404)
      expect(await listedIds(anonymous)).toEqual([])
      expect((await detail(anonymous, entry.id)).ok).toBe(false)
    })
    await anonymous.dispose()
    await admin.dispose()
  }
)

test(
  'CHG-P-17 the sitemap leaves out entries a crawler cannot read',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'routes/sitemap[.]xml.ts lists changelog entries without the label segment gate (see QUARANTINE.md)',
    },
  },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const label = await createLabel(admin, `${marker.slice(-30)} vip`, [segment])
    const gated = await createEntry(admin, {
      title: `${marker} gated`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
    })
    const open = await createEntry(admin, {
      title: `${marker} open`,
      state: 'published',
      notify: false,
    })
    const xml = await (await request.get('/sitemap.xml')).text()
    expect(xml).toContain(`/changelog/${open.id}`)
    expect(xml).not.toContain(`/changelog/${gated.id}`)
    await admin.dispose()
  }
)

test(
  'CHG-P-19 a shipped post linked from a published entry shows "In the changelog" in the feedback list',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const linked = await shippedPost(rest, marker, `${marker} linked post`)
    const unlinked = await shippedPost(rest, marker, `${marker} unlinked post`)
    await rest.dispose()
    const entry = await createEntry(admin, {
      title: `${marker} ships it`,
      state: 'published',
      notify: false,
      linkedPostIds: [linked.id],
    })

    await page.goto(`/?board=${linked.boardSlug}&status=${shipped(linked)}`)
    const chip = page.getByRole('link', { name: 'In the changelog' })
    await expect(page.getByText(linked.title)).toBeVisible()
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveAttribute('href', `/changelog/${entry.id}`)
    await page.goto(`/?board=${unlinked.boardSlug}&status=${shipped(unlinked)}`)
    await expect(page.getByText(unlinked.title)).toBeVisible()
    await expect(page.getByRole('link', { name: 'In the changelog' })).toHaveCount(0)
    // Unpublished: the chip goes.
    await updateEntry(admin, entry.id, { publishState: { type: 'draft' } })
    await page.goto(`/?board=${linked.boardSlug}&status=${shipped(linked)}`)
    await expect(page.getByText(linked.title)).toBeVisible()
    await expect(page.getByRole('link', { name: 'In the changelog' })).toHaveCount(0)
    await admin.dispose()
  }
)

test(
  'CHG-P-20 the portal nav has a Changelog tab and the page an RSS Feed link',
  { tag: '@nightly' },
  async ({ page }) => {
    await page.goto('/')
    const tab = page.getByRole('link', { name: 'Changelog', exact: true }).first()
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(page).toHaveURL(/\/changelog$/)
    await expect(page.getByRole('link', { name: /RSS Feed/ })).toHaveAttribute(
      'href',
      /\/changelog\/feed$/
    )
  }
)

test(
  'CHG-P-26 anonymous changelog pages are shared-cacheable for a minute; signed-in ones are not',
  { tag: '@nightly' },
  async ({ playwright, browser, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} cache`,
      state: 'published',
      notify: false,
    })
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    for (const path of ['/changelog', `/changelog/${entry.id}`]) {
      const res = await anonymous.get(path)
      expect(res.headers()['cache-control'], path).toBe(
        'public, s-maxage=60, stale-while-revalidate=600'
      )
    }
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const ctx = await portalContext(browser, customer)
    const res = await ctx.request.get(`/changelog/${entry.id}`)
    expect(res.headers()['cache-control'] ?? '').not.toContain('public')
    await ctx.close()
    await anonymous.dispose()
    await admin.dispose()
  }
)
