/**
 * The portal feed: default scope and order, sort controls, search and its
 * fallbacks, the filter panel (status, board, tag, more filters, views) and
 * its counts, held, deleted and merged posts, and the post card.
 *
 * Every assertion is scoped to the test's own board or a search word only
 * the test uses.
 *
 * Journeys: FBP-L-01 FBP-L-02 FBP-L-03 FBP-L-04 FBP-L-05 FBP-L-06 FBP-L-07 FBP-L-08
 * FBP-L-09 FBP-L-10 FBP-L-11 FBP-L-12 FBP-L-13 FBP-L-14 FBP-L-15 FBP-L-16
 * FBP-L-18 FBP-L-19 FBP-L-20 FBP-L-21 FBP-L-24 FBP-L-25 FBP-L-26
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mintCustomer } from '../../support/widget-portal'
import {
  adminRest,
  cardFor,
  clickUntil,
  createBoard,
  createTag,
  fbFn,
  personContext,
  portalCustomer,
  postPath,
  restPost,
  seedComment,
  seedPost,
  seedVotes,
  startPost,
  titleBox,
  visitor,
  wordFor,
  type TestBoard,
  type TestPost,
} from '../../product/feedback-portal'

interface FeedItem {
  id: string
  title: string
  moderationState?: string
  [key: string]: unknown
}
interface Feed {
  items: FeedItem[]
  hasMore: boolean
  total: number
  searchMode?: string
  facets?: {
    statuses: Record<string, number>
    boards: Record<string, number>
    tags: Record<string, number>
    total: number
    views: Record<string, number> | null
  }
}

/** The portal feed as a caller sees it. */
async function feed(request: APIRequestContext, data: Record<string, unknown>): Promise<Feed> {
  const res = await fbFn<Feed>(request, 'publicPosts', 'listPublicPostsFn', data)
  if (res.error) throw new Error(`listPublicPostsFn: ${res.error.message}`)
  return res.value as Feed
}

const ids = (f: Feed) => f.items.map((p) => p.id)
const titles = (f: Feed) => f.items.map((p) => p.title)

/** The order the cards stand in on the page. */
async function cardOrder(page: Page): Promise<string[]> {
  return page
    .locator('.post-card[data-post-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-post-id') as string))
}

const DAY = 86_400_000

/** Four posts whose Top, New and Trending orders all differ. */
async function sortFixture(board: TestBoard, marker: string) {
  const now = Date.now()
  const a = await seedPost(board, {
    title: `${marker} old popular`,
    voteCount: 10,
    createdAt: new Date(now - 10 * DAY),
  })
  const b = await seedPost(board, {
    title: `${marker} fresh warm`,
    voteCount: 3,
    createdAt: new Date(now - 3_600_000),
  })
  const c = await seedPost(board, {
    title: `${marker} two days`,
    voteCount: 5,
    createdAt: new Date(now - 2 * DAY),
  })
  const d = await seedPost(board, {
    title: `${marker} brand new`,
    voteCount: 0,
    createdAt: new Date(now),
  })
  return {
    top: [a, c, b, d].map((p) => p.id),
    new: [d, b, c, a].map((p) => p.id),
    trending: [b, c, a, d].map((p) => p.id),
  }
}

test.describe('portal feed', () => {
  test(
    'FBP-L-01 the home page streams the feed under Trending with the feedback head tags',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const order = await sortFixture(board, marker)
      const anon = await visitor(browser, marker)
      const page = anon.page
      const res = await page.goto('/')
      expect(res?.status()).toBe(200)
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(page.locator('.post-card[data-post-id]').first()).toBeVisible()
      expect(await page.locator('.post-card[data-post-id]').count()).toBeLessThanOrEqual(20)
      await expect(page).toHaveTitle(/^Feedback - /)
      const workspace = (await page.title()).replace(/^Feedback - /, '')
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        `Submit and vote on feature requests for ${workspace}. Help shape what gets built next.`
      )
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Feedback/)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/)

      // On this test's own board, the streamed feed is in Trending order.
      await page.goto(`/?board=${board.slug}`)
      await expect(cardFor(page, `${marker} brand new`)).toBeVisible()
      expect(await cardOrder(page)).toEqual(order.trending)
    }
  )

  test(
    'FBP-L-02 the default feed holds active and unstatused posts; a status pick replaces the default',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const active = await seedPost(board, { title: `${marker} planned`, statusSlug: 'planned' })
      const none = await seedPost(board, { title: `${marker} no status`, statusSlug: null })
      const done = await seedPost(board, { title: `${marker} complete`, statusSlug: 'complete' })
      await seedPost(board, { title: `${marker} closed`, statusSlug: 'closed' })
      const anon = await visitor(browser, marker)
      const base = await feed(anon.request, { boardSlug: board.slug, sort: 'new' })
      expect(ids(base).sort()).toEqual([active.id, none.id].sort())
      expect(base.facets?.total).toBe(2)
      const shipped = await feed(anon.request, {
        boardSlug: board.slug,
        statusSlugs: ['complete'],
      })
      expect(ids(shipped)).toEqual([done.id])

      // No status chip at the default scope.
      await anon.page.goto(`/?board=${board.slug}`)
      await expect(cardFor(anon.page, active.title)).toBeVisible()
      await expect(anon.page.getByText('Status:')).toBeHidden()
    }
  )

  test(
    'FBP-L-03 Top, New and Trending order the feed and stay in the URL',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const order = await sortFixture(board, marker)
      const anon = await visitor(browser, marker)
      for (const sort of ['top', 'new', 'trending'] as const) {
        expect(ids(await feed(anon.request, { boardSlug: board.slug, sort })), sort).toEqual(
          order[sort]
        )
      }
      const page = anon.page
      await page.goto(`/?board=${board.slug}`)
      await expect(cardFor(page, `${marker} brand new`)).toBeVisible()
      const top = page.getByRole('button', { name: 'Top', exact: true })
      await clickUntil(top, () =>
        expect(top).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 })
      )
      await expect(page).toHaveURL(/sort=top/)
      await expect.poll(() => cardOrder(page)).toEqual(order.top)
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await expect(page).toHaveURL(/sort=new/)
      await expect.poll(() => cardOrder(page)).toEqual(order.new)
      // The sort survives a reload and keeps the board.
      await page.reload()
      await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect.poll(() => cardOrder(page)).toEqual(order.new)
      // A hand-edited bad sort falls back to Trending.
      await page.goto(`/?board=${board.slug}&sort=bogus`)
      await expect(page.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect.poll(() => cardOrder(page)).toEqual(order.trending)
    }
  )

  test(
    'FBP-L-05 search matches word prefixes, ranks by relevance and switches to Best match',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const hit = await seedPost(board, { title: `${word}zapier integration`, voteCount: 1 })
      const weaker = await seedPost(board, {
        title: `${marker} other`,
        content: `mentions ${word}zapier once`,
        voteCount: 9,
      })
      await seedPost(board, { title: `${marker} unrelated` })
      const anon = await visitor(browser, marker)
      const res = await feed(anon.request, {
        boardSlug: board.slug,
        search: `${word}zap`,
        sort: 'relevance',
      })
      expect(ids(res)).toEqual([hit.id, weaker.id])

      const page = anon.page
      await page.goto(`/?board=${board.slug}`)
      await expect(cardFor(page, hit.title)).toBeVisible()
      const box = page
        .getByRole('searchbox', { name: 'Search posts' })
        .or(page.getByRole('textbox', { name: 'Search posts' }))
      await expect(async () => {
        // Typed before hydration the text is dropped: retype until the debounce applies it.
        await box.fill('')
        await box.fill(`${word}zap`)
        await expect(page).toHaveURL(/search=/, { timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Best match' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect.poll(() => cardOrder(page)).toEqual([hit.id, weaker.id])
      await page.getByRole('button', { name: 'Clear search' }).click()
      await expect(page.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(page.getByRole('button', { name: 'Best match' })).toBeHidden()
    }
  )

  test(
    'FBP-L-09 search reaches complete and closed posts the default view hides',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const done = await seedPost(board, { title: `${word} shipped thing`, statusSlug: 'complete' })
      const closed = await seedPost(board, { title: `${word} closed thing`, statusSlug: 'closed' })
      const anon = await visitor(browser, marker)
      expect(ids(await feed(anon.request, { boardSlug: board.slug }))).toEqual([])
      const found = await feed(anon.request, { boardSlug: board.slug, search: word })
      expect(ids(found).sort()).toEqual([done.id, closed.id].sort())
      await anon.page.goto(`/?board=${board.slug}&search=${word}`)
      await expect(cardFor(anon.page, done.title)).toBeVisible()
      await expect(cardFor(anon.page, closed.title)).toBeVisible()
    }
  )

  test(
    'FBP-L-11 status filter: two picks OR together, the chip names them, the URL keeps the slugs',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const planned = await seedPost(board, { title: `${marker} planned`, statusSlug: 'planned' })
      const progress = await seedPost(board, {
        title: `${marker} progress`,
        statusSlug: 'in_progress',
      })
      const open = await seedPost(board, { title: `${marker} open`, statusSlug: 'open' })
      const anon = await visitor(browser, marker)
      const both = await feed(anon.request, {
        boardSlug: board.slug,
        statusSlugs: ['planned', 'in_progress'],
      })
      expect(ids(both).sort()).toEqual([planned.id, progress.id].sort())

      const page = anon.page
      await page.goto(`/?board=${board.slug}`)
      await expect(cardFor(page, open.title)).toBeVisible()
      const pill = (name: string) =>
        page.getByRole('button', { name: new RegExp(`^${name}( \\d+)?$`) }).first()
      await clickUntil(pill('Planned'), () => expect(page).toHaveURL(/planned/, { timeout: 2_000 }))
      await pill('In Progress').click()
      await expect(page).toHaveURL(/in_progress/)
      await expect(cardFor(page, planned.title)).toBeVisible()
      await expect(cardFor(page, progress.title)).toBeVisible()
      await expect(cardFor(page, open.title)).toBeHidden()
      await expect(page.getByText('Status:')).toBeVisible()
      await page.reload()
      await expect(cardFor(page, progress.title)).toBeVisible()
      await expect(cardFor(page, open.title)).toBeHidden()
    }
  )

  test(
    'FBP-L-12 a board pick narrows the feed and locks the composer; an unknown or hidden slug is empty',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker, { suffix: 'one' })
      const other = await createBoard(marker, { suffix: 'two' })
      const hidden = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const mine = await seedPost(board, { title: `${marker} on one` })
      await seedPost(other, { title: `${marker} on two` })
      await seedPost(hidden, { title: `${marker} on team` })
      const cass = await portalCustomer(browser, marker)
      expect(titles(await feed(cass.request, { boardSlug: board.slug }))).toEqual([mine.title])
      expect(ids(await feed(cass.request, { boardSlug: hidden.slug }))).toEqual([])
      expect(ids(await feed(cass.request, { boardSlug: `${marker}-nope` }))).toEqual([])

      const page = cass.page
      await page.goto(`/?board=${board.slug}`)
      await expect(cardFor(page, mine.title)).toBeVisible()
      await expect(cardFor(page, `${marker} on two`)).toBeHidden()
      await startPost(page, `${marker} locked`)
      // The board is the page context: named, not a picker.
      await expect(page.getByLabel(`Posting to ${board.name}`)).toBeVisible()
      await expect(page.getByLabel(`Posting to ${board.name}`).getByRole('combobox')).toHaveCount(0)
      await page.goto(`/?board=${hidden.slug}`)
      await expect(cardFor(page, `${marker} on team`)).toBeHidden()
    }
  )

  test(
    'FBP-L-13 customers see and filter only public tags; an internal tag id does nothing; the team sees all',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const pub = await createTag(`${marker} public`)
      const internal = await createTag(`${marker} internal`, false)
      const tagged = await seedPost(board, {
        title: `${marker} tagged`,
        tagUuids: [pub.uuid, internal.uuid],
      })
      const plain = await seedPost(board, { title: `${marker} plain` })
      const cass = await portalCustomer(browser, marker)
      const tags = await fbFn<Array<{ id: string; name: string }>>(
        cass.request,
        'portal',
        'fetchPublicTags'
      )
      const names = (tags.value ?? []).map((t) => t.name)
      expect(names).toContain(pub.name)
      expect(names).not.toContain(internal.name)
      expect(ids(await feed(cass.request, { boardSlug: board.slug, tagIds: [pub.id] }))).toEqual([
        tagged.id,
      ])
      // A crafted internal tag id reveals nothing: no post is matched through it.
      const crafted = await feed(cass.request, { boardSlug: board.slug, tagIds: [internal.id] })
      expect(ids(crafted)).toEqual([])
      expect(ids(await feed(cass.request, { boardSlug: board.slug })).sort()).toEqual(
        [tagged.id, plain.id].sort()
      )
      // The card shows only the public tag.
      await cass.page.goto(`/?board=${board.slug}`)
      const card = cardFor(cass.page, tagged.title)
      await expect(card.getByText(pub.name)).toBeVisible()
      await expect(card.getByText(internal.name)).toBeHidden()
      // The team sees both.
      const admin = await personContext(browser, (await adminUser()).userUuid, marker)
      await admin.page.goto(`/?board=${board.slug}`)
      await expect(cardFor(admin.page, tagged.title).getByText(internal.name)).toBeVisible()
    }
  )

  test(
    'FBP-L-16 each panel dimension counts with its own filter left out; empty pills show no number',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      await seedPost(board, { title: `${marker} p1`, statusSlug: 'planned' })
      await seedPost(board, { title: `${marker} p2`, statusSlug: 'planned' })
      await seedPost(board, { title: `${marker} o1`, statusSlug: 'open' })
      const anon = await visitor(browser, marker)
      const all = await feed(anon.request, { boardSlug: board.slug })
      const statuses = all.facets?.statuses ?? {}
      // Status counts are keyed by slug.
      expect(statuses.planned).toBe(2)
      expect(statuses.open).toBe(1)
      // Picking Planned still counts Open: status is counted without its own filter.
      const picked = await feed(anon.request, { boardSlug: board.slug, statusSlugs: ['planned'] })
      expect(picked.items).toHaveLength(2)
      expect(picked.facets?.statuses.open).toBe(1)
      expect(picked.facets?.total).toBe(2)
      // The board count follows the status filter.
      expect(Object.values(picked.facets?.boards ?? {})).toContain(2)

      await anon.page.goto(`/?board=${board.slug}`)
      await expect(cardFor(anon.page, `${marker} p1`)).toBeVisible()
      await expect(anon.page.getByRole('button', { name: /^Planned 2$/ }).first()).toBeVisible()
      await expect(anon.page.getByRole('button', { name: /^Open 1$/ }).first()).toBeVisible()
      // A status with no posts here shows no number.
      await expect(anon.page.getByRole('button', { name: /^Closed$/ }).first()).toBeVisible()
    }
  )

  test(
    'FBP-L-18 a signed-in customer filters to My posts, Voted and Following, each with its count',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const cass = await portalCustomer(browser, marker)
      const mine = await seedPost(board, {
        title: `${marker} mine`,
        authorPrincipalUuid: cass.principalUuid,
        statusSlug: 'complete',
      })
      const voted = await seedPost(board, { title: `${marker} voted` })
      await seedVotes(voted, [cass.principalUuid])
      const followed = await seedPost(board, { title: `${marker} followed` })
      await supportDb()`INSERT INTO post_subscriptions (id, post_id, principal_id, reason)
        VALUES (gen_random_uuid(), ${followed.uuid}, ${cass.principalUuid}, 'manual')`
      await seedPost(board, { title: `${marker} someone else` })

      const view = async (v: string) => feed(cass.request, { boardSlug: board.slug, view: v })
      // My posts lifts the active-only default (the post is complete).
      expect(ids(await view('mine'))).toEqual([mine.id])
      expect(ids(await view('voted'))).toEqual([voted.id])
      expect(ids(await view('following'))).toEqual([followed.id])
      const counts = (await feed(cass.request, { boardSlug: board.slug })).facets?.views
      expect(counts).toMatchObject({ mine: 1, voted: 1, following: 1 })

      await cass.page.goto(`/?board=${board.slug}`)
      await expect(cardFor(cass.page, voted.title)).toBeVisible()
      const myPosts = cass.page.getByRole('button', { name: /^My posts/ })
      await clickUntil(myPosts, () => expect(cass.page).toHaveURL(/view=mine/, { timeout: 2_000 }))
      await expect(cardFor(cass.page, mine.title)).toBeVisible()
      await expect(cardFor(cass.page, voted.title)).toBeHidden()
    }
  )

  test(
    'FBP-L-19 an anonymous session has no views: ?view=mine shows the whole feed and no Show section',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const ghost = await mintCustomer({ anonymous: true })
      const a = await seedPost(board, {
        title: `${marker} by ghost`,
        authorPrincipalUuid: ghost.principalUuid,
      })
      const b = await seedPost(board, { title: `${marker} by other` })
      const ctx = await personContext(browser, ghost.userUuid, marker)
      const res = await feed(ctx.request, { boardSlug: board.slug, view: 'mine' })
      expect(ids(res).sort()).toEqual([a.id, b.id].sort())
      expect(res.facets?.views ?? null).toBeNull()
      await ctx.page.goto(`/?board=${board.slug}&view=mine`)
      await expect(cardFor(ctx.page, b.title)).toBeVisible()
      await expect(ctx.page.getByRole('button', { name: /^My posts/ })).toBeHidden()
    }
  )

  test(
    'FBP-L-20 owner and segment filters are ignored for customers and honoured for the team',
    { tag: '@core' },
    async ({ browser, marker, people }) => {
      const board = await createBoard(marker)
      const owned = await seedPost(board, { title: `${marker} owned` })
      const loose = await seedPost(board, { title: `${marker} loose` })
      const adminP = await supportDb()`SELECT id FROM principal WHERE user_id = (
        SELECT id FROM "user" WHERE email = ${people.people.admin.email})`
      await supportDb()`UPDATE posts SET owner_principal_id = ${adminP[0].id} WHERE id = ${owned.uuid}`
      const cass = await portalCustomer(browser, marker)
      const asCustomer = await feed(cass.request, {
        boardSlug: board.slug,
        owner: people.people.admin.principalId,
      })
      expect(ids(asCustomer).sort()).toEqual([owned.id, loose.id].sort())
      const admin = await personContext(browser, (await adminUser()).userUuid, marker)
      const asTeam = await feed(admin.request, {
        boardSlug: board.slug,
        owner: people.people.admin.principalId,
      })
      expect(ids(asTeam)).toEqual([owned.id])
    }
  )

  test(
    'FBP-L-24 a held post shows to its author (with the pending panel) and the team, and to nobody else',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const author = await portalCustomer(browser, marker, { suffix: 'author' })
      const held = await seedPost(board, {
        title: `${marker} held`,
        authorPrincipalUuid: author.principalUuid,
        moderationState: 'pending',
      })
      const live = await seedPost(board, { title: `${marker} live` })
      const other = await portalCustomer(browser, marker, { suffix: 'other' })
      const anon = await visitor(browser, marker)
      const admin = await personContext(browser, (await adminUser()).userUuid, marker)

      expect(ids(await feed(author.request, { boardSlug: board.slug })).sort()).toEqual(
        [held.id, live.id].sort()
      )
      expect(
        (await feed(author.request, { boardSlug: board.slug, view: 'mine' })).items[0]
      ).toMatchObject({
        id: held.id,
        moderationState: 'pending',
      })
      for (const who of [other, anon]) {
        const f = await feed(who.request, { boardSlug: board.slug })
        expect(ids(f)).toEqual([live.id])
        expect(f.facets?.total).toBe(1)
        const res = await who.page.goto(postPath(held))
        expect(res?.status()).toBe(404)
      }
      expect(ids(await feed(admin.request, { boardSlug: board.slug })).sort()).toEqual(
        [held.id, live.id].sort()
      )
      // The author can open it.
      const res = await author.page.goto(postPath(held))
      expect(res?.status()).toBe(200)
      await expect(author.page.getByRole('heading', { level: 1, name: held.title })).toBeVisible()
      await expect(author.page.getByText('Pending review').first()).toBeVisible()
    }
  )

  test(
    "FBP-L-24 the author's held post shows its pending panel on the first server-rendered feed page",
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B03: fetchPortalData builds the first feed page without moderationState, so the card has no pending panel until a refetch',
      },
    },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const author = await portalCustomer(browser, marker)
      const held = await seedPost(board, {
        title: `${marker} held`,
        authorPrincipalUuid: author.principalUuid,
        moderationState: 'pending',
      })
      await author.page.goto(`/?board=${board.slug}`)
      const card = cardFor(author.page, held.title)
      await expect(card).toBeVisible()
      await expect(card.getByText('Pending review')).toBeVisible()
    }
  )

  test(
    'FBP-L-25 deleted posts, posts on a deleted board and merged-away posts leave the feed and search',
    { tag: '@core' },
    async ({ browser, marker, playwright }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const goneBoard = await createBoard(marker, { suffix: 'gone' })
      const deleted = await seedPost(board, { title: `${word} deleted`, deletedAt: new Date() })
      const orphan = await seedPost(goneBoard, { title: `${word} orphan` })
      const canonical = await seedPost(board, { title: `${word} canonical`, voteCount: 0 })
      const dupe = await seedPost(board, { title: `${word} duplicate`, voteCount: 0 })
      const voter = await mintCustomer({ email: `${marker}-voter@customers.example` })
      await seedVotes(dupe, [voter.principalUuid])
      await supportDb()`UPDATE boards SET deleted_at = now() WHERE id = ${goneBoard.uuid}`
      const admin = await adminRest(playwright, marker)
      await restPost(admin, `/posts/${dupe.id}/merge`, { canonicalPostId: canonical.id })

      const anon = await visitor(browser, marker)
      const listed = await feed(anon.request, { search: word })
      expect(ids(listed)).toEqual([canonical.id])
      expect(listed.items[0]).toMatchObject({ voteCount: 1 })
      for (const p of [deleted, orphan]) {
        const res = await anon.page.goto(postPath(p))
        expect(res?.status(), p.title).toBe(404)
      }
      const res = await anon.page.goto(postPath(dupe))
      expect(res?.status()).toBe(200)
      await expect(anon.page.getByText(/merged into/i).first()).toBeVisible()
    }
  )

  test(
    'FBP-L-26 a card shows status, public tags, comment count, author and time, and opens the post',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const tag = await createTag(`${marker} tag`)
      const author = await mintCustomer({
        email: `${marker}-author@customers.example`,
        name: 'Quill Author',
      })
      const post = await seedPost(board, {
        title: `${marker} full card`,
        content: 'A **plain** excerpt here',
        statusSlug: 'planned',
        authorPrincipalUuid: author.principalUuid,
        tagUuids: [tag.uuid],
        voteCount: 4,
      })
      await seedComment(post, { content: 'one', principalUuid: author.principalUuid })
      await seedComment(post, { content: 'two', principalUuid: author.principalUuid })
      const anon = await visitor(browser, marker)
      await anon.page.goto(`/?board=${board.slug}`)
      const card = cardFor(anon.page, post.title)
      await expect(card.getByText('Planned')).toBeVisible()
      await expect(card.getByText(tag.name)).toBeVisible()
      await expect(card.getByText('Quill Author')).toBeVisible()
      await expect(card.getByText('A plain excerpt here')).toBeVisible()
      await expect(card.getByTestId('vote-count')).toHaveText('4')
      await expect(card.locator('span').filter({ hasText: /^2$/ })).toHaveCount(1)
      await clickUntil(card.getByRole('link', { name: post.title }), () =>
        expect(anon.page).toHaveURL(new RegExp(`${postPath(post)}$`), { timeout: 2_000 })
      )
    }
  )

  // -------------------------------------------------------------------------
  // Nightly
  // -------------------------------------------------------------------------

  test(
    'FBP-L-06 with no post holding every word, posts with most of the words show under a banner',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const w = [
        wordFor(marker, 'a'),
        wordFor(marker, 'b'),
        wordFor(marker, 'c'),
        wordFor(marker, 'd'),
      ]
      const board = await createBoard(marker)
      const most = await seedPost(board, { title: `${w[0]} ${w[1]} ${w[2]}` })
      await seedPost(board, { title: `${w[3]} only` })
      const anon = await visitor(browser, marker)
      const res = await feed(anon.request, { boardSlug: board.slug, search: w.join(' ') })
      expect(res.searchMode).toBe('most')
      expect(ids(res)).toEqual([most.id])
      await anon.page.goto(`/?board=${board.slug}&search=${encodeURIComponent(w.join(' '))}`)
      await expect(
        anon.page.getByText('No post has all your words. Showing posts with most of them.')
      ).toBeVisible()
      await expect(cardFor(anon.page, most.title)).toBeVisible()
    }
  )

  test(
    'FBP-L-07 a misspelt word finds a similar spelling under its banner',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${word}notifications` })
      const typo = `${word}notificatoins`
      const anon = await visitor(browser, marker)
      const res = await feed(anon.request, { boardSlug: board.slug, search: typo })
      expect(res.searchMode).toBe('similar')
      expect(ids(res)).toEqual([post.id])
      await anon.page.goto(`/?board=${board.slug}&search=${typo}`)
      await expect(
        anon.page.getByText('No exact matches. Showing posts with a similar spelling.')
      ).toBeVisible()
    }
  )

  test(
    'FBP-L-08 quoted phrases and operators are searched as written and never widened',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const [a, b] = [wordFor(marker, 'a'), wordFor(marker, 'b')]
      const board = await createBoard(marker)
      await seedPost(board, { title: `${a} something ${b}` })
      const anon = await visitor(browser, marker)
      const quoted = await feed(anon.request, { boardSlug: board.slug, search: `"${a} ${b}"` })
      expect(quoted.items).toEqual([])
      expect(quoted.searchMode).toBeUndefined()
      const minus = await feed(anon.request, { boardSlug: board.slug, search: `${a} -${b}` })
      expect(minus.items).toEqual([])
      expect(minus.searchMode).toBeUndefined()
    }
  )

  test(
    'FBP-L-10 a search with no result offers to post it and hands the words to the composer',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const word = wordFor(marker)
      const board = await createBoard(marker)
      await seedPost(board, { title: `${marker} unrelated` })
      const cass = await portalCustomer(browser, marker)
      await cass.page.goto(`/?board=${board.slug}&search=${word}`)
      await expect(cass.page.getByText(`No posts match “${word}”.`)).toBeVisible()
      const create = cass.page.getByRole('button', { name: 'Create a post from it' })
      await clickUntil(create, () =>
        expect(titleBox(cass.page)).toHaveValue(word, { timeout: 2_000 })
      )
      await expect(cass.page.getByLabel(/^Posting to/)).toBeVisible()
    }
  )

  test(
    'FBP-L-14 more filters: minimum votes, posted-in window and team response',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const popular = await seedPost(board, { title: `${marker} popular`, voteCount: 8 })
      const old = await seedPost(board, {
        title: `${marker} old`,
        voteCount: 1,
        createdAt: new Date(Date.now() - 40 * DAY),
      })
      const answered = await seedPost(board, { title: `${marker} answered`, voteCount: 1 })
      const admin = await adminUser()
      await seedComment(answered, {
        content: 'team here',
        principalUuid: admin.principalUuid,
        isTeamMember: true,
      })
      const anon = await visitor(browser, marker)
      expect(ids(await feed(anon.request, { boardSlug: board.slug, minVotes: 5 }))).toEqual([
        popular.id,
      ])
      const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
      const recent = await feed(anon.request, { boardSlug: board.slug, dateFrom: since })
      expect(ids(recent)).not.toContain(old.id)
      expect(ids(recent)).toContain(popular.id)
      expect(
        ids(await feed(anon.request, { boardSlug: board.slug, responded: 'responded' }))
      ).toEqual([answered.id])
      await anon.page.goto(`/?board=${board.slug}&minVotes=5`)
      await expect(cardFor(anon.page, popular.title)).toBeVisible()
      await expect(cardFor(anon.page, old.title)).toBeHidden()
    }
  )

  test(
    'FBP-L-15 a bad sort falls back and a bad view is dropped',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} survivor` })
      const anon = await visitor(browser, marker)
      for (const q of ['sort=bogus', 'view=everything']) {
        const res = await anon.page.goto(`/?board=${board.slug}&${q}`)
        expect(res?.status(), q).toBe(200)
        await expect(cardFor(anon.page, post.title), q).toBeVisible()
      }
    }
  )

  test(
    'FBP-L-15 a hand-edited bad minVotes or dateFrom is ignored like a bad sort',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'FBP-B02: routes/_portal/index.tsx gives minVotes and dateFrom no .catch, so a bad value fails route validation',
      },
    },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const post = await seedPost(board, { title: `${marker} survivor` })
      const anon = await visitor(browser, marker)
      for (const q of ['minVotes=abc', 'dateFrom=2026-13-45']) {
        const res = await anon.page.goto(`/?board=${board.slug}&${q}`)
        expect(res?.status(), q).toBe(200)
        await expect(cardFor(anon.page, post.title), q).toBeVisible()
      }
    }
  )

  test(
    'FBP-L-21 scrolling to the end loads the next 20 posts',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const posts: TestPost[] = []
      for (let i = 0; i < 25; i++) {
        posts.push(
          await seedPost(board, {
            title: `${marker} n${String(i).padStart(2, '0')}`,
            voteCount: 100 - i,
          })
        )
      }
      const anon = await visitor(browser, marker)
      const p1 = await feed(anon.request, { boardSlug: board.slug, sort: 'top', page: 1 })
      const p2 = await feed(anon.request, { boardSlug: board.slug, sort: 'top', page: 2 })
      expect(p1.items).toHaveLength(20)
      expect(p1.hasMore).toBe(true)
      expect([...ids(p1), ...ids(p2)]).toEqual(posts.map((p) => p.id))

      await anon.page.goto(`/?board=${board.slug}&sort=top`)
      await expect(anon.page.locator('.post-card[data-post-id]')).toHaveCount(20)
      // Scroll until the sentinel's observer (attached after hydration) loads page two.
      await expect(async () => {
        await anon.page.mouse.wheel(0, -400)
        await anon.page.locator('.post-card[data-post-id]').last().scrollIntoViewIfNeeded()
        await anon.page.mouse.wheel(0, 5000)
        await expect(anon.page.locator('.post-card[data-post-id]')).toHaveCount(25, {
          timeout: 2_000,
        })
      }).toPass({ timeout: 20_000 })
    }
  )

  test(
    'FBP-L-04 pinned posts lead Top, New and Trending, most recently pinned first',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const order = await sortFixture(board, marker)
      const now = Date.now()
      const early = await seedPost(board, {
        title: `${marker} pinned early`,
        pinnedAt: new Date(now - 60_000),
        createdAt: new Date(now - 20 * DAY),
      })
      const late = await seedPost(board, {
        title: `${marker} pinned late`,
        pinnedAt: new Date(now - 1_000),
        createdAt: new Date(now - 30 * DAY),
      })
      const anon = await visitor(browser, marker)
      for (const sort of ['top', 'new', 'trending'] as const) {
        expect(ids(await feed(anon.request, { boardSlug: board.slug, sort })), sort).toEqual([
          late.id,
          early.id,
          ...order[sort],
        ])
      }
    }
  )
})

let adminCache: { userUuid: string; principalUuid: string } | null = null
/** The suite admin's user and principal uuids. */
async function adminUser(): Promise<{ userUuid: string; principalUuid: string }> {
  if (adminCache) return adminCache
  const [row] = await supportDb()`SELECT u.id AS user_id, p.id AS principal_id FROM "user" u
    JOIN principal p ON p.user_id = u.id WHERE u.email = 'e2e-support-admin@example.com'`
  adminCache = { userUuid: row.user_id as string, principalUuid: row.principal_id as string }
  return adminCache
}
