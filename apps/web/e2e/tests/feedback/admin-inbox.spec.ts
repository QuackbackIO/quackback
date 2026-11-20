/**
 * The team's feedback inbox: list, filters, search, saved views, keyboard.
 *
 * Journeys: FBA-I-01 I-02 I-03 I-04 I-05 I-06 I-07 I-08 I-09 I-10 I-11 I-12 I-13 I-14
 * I-15 I-16 I-17 I-18 I-20 I-21 I-24 I-25 I-26 I-27 I-28 I-30 I-32. Lower rows I-22,
 * I-29 and I-31 are in post.inbox.db.test.ts; I-19 in post.search.test.ts.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi, serverFnId } from '../../support/server-fns'
import { pollFor, supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import {
  customerPost,
  inboxTitles,
  makeBoard,
  makePost,
  makeTag,
  openInbox,
  openPost,
  portalCustomer,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  addComment,
  backdatePost,
  expectTitlesUnordered,
  filterOption,
  insertSuggestion,
  makeSegment,
  manageButton,
  searchParam,
  setOwner,
  uniqueWord,
} from '../../product/feedback-admin-inbox'

/** A row of the inbox list (the badge sits beside the card). */
function rowOf(page: Page, title: string) {
  return page
    .locator('div.group.relative.flex', { has: page.locator('h3', { hasText: title }) })
    .first()
}

test(
  'FBA-I-01 the inbox opens on the newest posts, 20 per page, without deleted or merged posts',
  { tag: '@smoke' },
  async ({ playwright, asPerson, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const titles: string[] = []
    for (let i = 1; i <= 21; i++) {
      const title = `${marker} idea ${String(i).padStart(2, '0')}`
      await makePost(api, { boardId: board.id, title, content: `Details of ${title}` })
      titles.push(title)
    }
    // A deleted post and a post merged into another never show.
    const gone = await makePost(api, { boardId: board.id, title: `${marker} deleted one` })
    const merged = await makePost(api, { boardId: board.id, title: `${marker} merged one` })
    const sql = supportDb()
    const [canonical] = await sql`SELECT id FROM posts WHERE title = ${titles[0]}`
    await sql`UPDATE posts SET deleted_at = now() WHERE id = ${uuid(gone.id)}`
    await sql`UPDATE posts SET canonical_post_id = ${canonical.id}, merged_at = now()
              WHERE id = ${uuid(merged.id)}`
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    const newestFirst = [...titles].reverse()
    await expect.poll(() => inboxTitles(admin, marker)).toEqual(newestFirst.slice(0, 20))

    // A row carries its status, author and snippet.
    const row = admin.locator('div', { has: admin.locator('h3', { hasText: titles[20] }) }).last()
    await expect(row.getByText('Ada Admin')).toBeVisible()
    await expect(row.getByText(`Details of ${titles[20]}`)).toBeVisible()
    await expect(row.getByText('Open', { exact: true })).toBeVisible()

    await admin.getByRole('button', { name: 'Load more' }).click()
    await expect.poll(() => inboxTitles(admin, marker)).toEqual(newestFirst)
  }
)

test(
  'FBA-I-02 a teammate without post.view_private gets the no-access page and every inbox read refuses',
  { tag: '@core' },
  async ({ playwright, browser, newTeammate, marker }) => {
    const roleKey = await createRole(marker, ['member.view', 'conversation.view'])
    const mate = await newTeammate({ roleKey })
    const page = await mate.newPage(browser)
    const listId = serverFnId('fetchInboxPostsForAdmin')
    const listReads: string[] = []
    page.on('request', (r) => {
      if (r.url().includes(listId)) listReads.push(r.url())
    })
    await page.goto('/admin/feedback')
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByPlaceholder('Search posts…')).toHaveCount(0)
    expect(listReads).toEqual([])

    const api = await mate.api(playwright)
    for (const fn of ['fetchInboxPostsForAdmin', 'fetchInboxFilterCounts']) {
      const res = await callServerFn(api, fn, {}, { method: 'GET' })
      expect(res.ok, fn).toBe(false)
    }
    await api.dispose()
  }
)

test(
  'FBA-I-04 the status filter narrows the list, keeps the other counts and takes a hand-typed slug',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const open = await makePost(api, { boardId: board.id, title: `${marker} open one` })
    const planned = await makePost(api, {
      boardId: board.id,
      title: `${marker} planned one`,
      statusId: await statusIdBySlug('planned'),
    })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [open.title, planned.title])
    await filterOption(admin, 'Open', 1).click()
    await expectTitlesUnordered(admin, marker, [open.title])
    expect(searchParam(admin, 'status')).toEqual(['open'])
    // A dimension's counts ignore its own filter: Planned still says 1.
    await expect(filterOption(admin, 'Planned', 1)).toBeVisible()
    await expect(filterOption(admin, 'Open', 1)).toHaveAttribute('aria-selected', 'true')

    // Removing the chip clears only the status filter.
    await admin.getByRole('button', { name: 'Remove Status: Open filter' }).click()
    await expectTitlesUnordered(admin, marker, [open.title, planned.title])
    expect(searchParam(admin, 'board')).toEqual([board.id])

    // A single slug typed by hand is a one-item list.
    await admin.goto(
      `/admin/feedback?status=planned&board=${encodeURIComponent(JSON.stringify([board.id]))}`
    )
    await expectTitlesUnordered(admin, marker, [planned.title])
  }
)

test(
  'FBA-I-05 selecting two boards lists posts from either, with a count per board',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const one = await makeBoard(api, `${marker}-one`)
    const two = await makeBoard(api, `${marker}-two`)
    const three = await makeBoard(api, `${marker}-three`)
    const a = await makePost(api, { boardId: one.id, title: `${marker} on one` })
    const b = await makePost(api, { boardId: two.id, title: `${marker} on two` })
    const b2 = await makePost(api, { boardId: two.id, title: `${marker} also on two` })
    const c = await makePost(api, { boardId: three.id, title: `${marker} on three` })
    await api.dispose()

    const admin = await asPerson('admin')
    // Board counts obey the other filters: a search for the marker scopes them to this test.
    await openInbox(admin, { search: marker })
    await expect(filterOption(admin, one.name, 1)).toBeVisible({ timeout: 15_000 })
    await expect(filterOption(admin, two.name, 2)).toBeVisible()
    await filterOption(admin, one.name, 1).click()
    await expectTitlesUnordered(admin, marker, [a.title])
    await filterOption(admin, two.name, 2).click({ modifiers: ['ControlOrMeta'] })
    await expectTitlesUnordered(admin, marker, [a.title, b.title, b2.title])
    expect((searchParam(admin, 'board') as string[]).sort()).toEqual([one.id, two.id].sort())
    await expect(admin.locator('h3', { hasText: c.title })).toHaveCount(0)
  }
)

test(
  'FBA-I-06 two tags list posts carrying either tag, with a count per tag',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const tagA = await makeTag(api, `A ${marker}`.slice(0, 50))
    const tagB = await makeTag(api, `B ${marker}`.slice(0, 50))
    const onlyA = await makePost(api, {
      boardId: board.id,
      title: `${marker} only A`,
      tagIds: [tagA.id],
    })
    const onlyB = await makePost(api, {
      boardId: board.id,
      title: `${marker} only B`,
      tagIds: [tagB.id],
    })
    const both = await makePost(api, {
      boardId: board.id,
      title: `${marker} both`,
      tagIds: [tagA.id, tagB.id],
    })
    const none = await makePost(api, { boardId: board.id, title: `${marker} untagged` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [onlyA.title, onlyB.title, both.title, none.title])
    await expect(filterOption(admin, tagA.name, 2)).toBeVisible()
    await expect(filterOption(admin, tagB.name, 2)).toBeVisible()
    await filterOption(admin, tagA.name, 2).click()
    await expectTitlesUnordered(admin, marker, [onlyA.title, both.title])
    await filterOption(admin, tagB.name, 2).click()
    await expectTitlesUnordered(admin, marker, [onlyA.title, onlyB.title, both.title])
    expect((searchParam(admin, 'tags') as string[]).sort()).toEqual([tagA.id, tagB.id].sort())
  }
)

test(
  'FBA-I-08 Assigned to lists a teammate’s posts, and Unassigned the posts with no owner',
  { tag: '@core' },
  async ({ playwright, asPerson, people, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const owned = await makePost(api, { boardId: board.id, title: `${marker} owned by Ben` })
    const free = await makePost(api, { boardId: board.id, title: `${marker} nobody owns` })
    await setOwner(api, owned.id, people.people.agentB.principalId)
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [owned.title, free.title])
    await admin.getByRole('button', { name: 'Filter', exact: true }).click()
    await admin.getByRole('button', { name: 'Assigned to' }).click()
    await admin.getByRole('button', { name: people.people.agentB.displayName, exact: true }).click()
    await expectTitlesUnordered(admin, marker, [owned.title])
    expect(searchParam(admin, 'owner')).toBe(people.people.agentB.principalId)

    await admin.keyboard.press('Escape')
    await admin.getByRole('button', { name: 'Filter', exact: true }).click()
    await admin.getByRole('button', { name: 'Assigned to' }).click()
    await admin.getByRole('button', { name: 'Unassigned', exact: true }).click()
    await expectTitlesUnordered(admin, marker, [free.title])
    expect(searchParam(admin, 'owner')).toBe('unassigned')

    // The literal works from the URL too.
    await admin.reload()
    await expectTitlesUnordered(admin, marker, [free.title])
  }
)

test(
  'FBA-I-11 Responded lists posts with a public team reply; a private note is not a response',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'post.inbox.ts:44 counts any team comment, including private internal notes (QUARANTINE.md)',
    },
  },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const replied = await makePost(api, { boardId: board.id, title: `${marker} replied` })
    const noted = await makePost(api, { boardId: board.id, title: `${marker} noted privately` })
    const quiet = await makePost(api, { boardId: board.id, title: `${marker} quiet` })
    await addComment(api, replied.id, `Public reply ${marker}`)
    await addComment(api, noted.id, `Internal note ${marker}`, { isPrivate: true })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [replied.title, noted.title, quiet.title])
    await filterOption(admin, 'Responded').click()
    await expect.poll(() => searchParam(admin, 'responded')).toBe('responded')
    // The bug: the private note puts "noted privately" under Responded.
    await expectTitlesUnordered(admin, marker, [replied.title])
    await expect(filterOption(admin, 'Responded', 1)).toBeVisible()
    await filterOption(admin, 'Unresponded', 2).click()
    await expectTitlesUnordered(admin, marker, [noted.title, quiet.title])
  }
)

test(
  'FBA-I-12 Has duplicates lists only posts with a pending suggestion, and nothing when none has one',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'feedback-table-view.tsx:244 filters in the browser and skips the filter when no loaded post has a suggestion (QUARANTINE.md)',
    },
  },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const dupe = await makePost(api, { boardId: board.id, title: `${marker} dupe` })
    const original = await makePost(api, { boardId: board.id, title: `${marker} original` })
    const alone = await makePost(api, { boardId: board.id, title: `${marker} alone` })
    const suggestion = await insertSuggestion(dupe.id, original.id)
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], hasDuplicates: true })
    await expectTitlesUnordered(admin, marker, [dupe.title, original.title])

    // Dismissed: no post on the board has a pending suggestion, so nothing matches.
    await supportDb()`UPDATE post_merge_suggestions SET status = 'dismissed', resolved_at = now()
                      WHERE id = ${suggestion}`
    await admin.reload()
    await expect(admin.getByText('No results for these filters')).toBeVisible({ timeout: 15_000 })
    await expect(admin.locator('h3', { hasText: alone.title })).toHaveCount(0)
  }
)

test(
  'FBA-I-13 a row shows how many pending duplicate suggestions name the post, on either side',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const hub = await makePost(api, { boardId: board.id, title: `${marker} hub` })
    const x = await makePost(api, { boardId: board.id, title: `${marker} x` })
    const y = await makePost(api, { boardId: board.id, title: `${marker} y` })
    const z = await makePost(api, { boardId: board.id, title: `${marker} z` })
    await insertSuggestion(x.id, hub.id)
    await insertSuggestion(hub.id, y.id)
    const old = await insertSuggestion(z.id, hub.id)
    await supportDb()`UPDATE post_merge_suggestions SET status = 'dismissed' WHERE id = ${old}`
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect(rowOf(admin, hub.title).getByText('2 duplicates')).toBeVisible({ timeout: 15_000 })
    await expect(rowOf(admin, x.title).getByText('1 duplicate', { exact: true })).toBeVisible()
    await expect(rowOf(admin, y.title).getByText('1 duplicate', { exact: true })).toBeVisible()
    await expect(rowOf(admin, z.title).getByText(/duplicate/)).toHaveCount(0)
  }
)

test(
  'FBA-I-14 Deleted posts lists posts deleted in the last 30 days only',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const live = await makePost(api, { boardId: board.id, title: `${marker} live` })
    const recent = await makePost(api, { boardId: board.id, title: `${marker} deleted lately` })
    const old = await makePost(api, { boardId: board.id, title: `${marker} deleted long ago` })
    expect((await callServerFn(api, 'deletePostFn', { id: recent.id })).ok).toBe(true)
    await backdatePost(old.id, { deletedDaysAgo: 31 })

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [live.title])
    await expect(filterOption(admin, 'Deleted posts', 1)).toBeVisible()
    await filterOption(admin, 'Deleted posts', 1).click()
    await expectTitlesUnordered(admin, marker, [recent.title])
    expect(searchParam(admin, 'deleted')).toBe(true)

    // The 31-day-old one cannot come back.
    const res = await callServerFn(api, 'restorePostFn', { id: old.id })
    expect(res.ok).toBe(false)
    expect(res.raw).toMatch(/RESTORE_EXPIRED|30 days/)
    await api.dispose()
  }
)

test(
  'FBA-I-15 each sort orders the list as documented, and Newest stays out of the URL',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const old = await makePost(api, { boardId: board.id, title: `${marker} old` })
    const mid = await makePost(api, { boardId: board.id, title: `${marker} mid` })
    const fresh = await makePost(api, { boardId: board.id, title: `${marker} fresh` })
    await api.dispose()
    const sql = supportDb()
    await backdatePost(old.id, { createdDaysAgo: 40 })
    await backdatePost(mid.id, { createdDaysAgo: 10 })
    await sql`UPDATE posts SET vote_count = 5 WHERE id = ${uuid(old.id)}`
    await sql`UPDATE posts SET vote_count = 1, comment_count = 3 WHERE id = ${uuid(mid.id)}`
    await sql`UPDATE posts SET vote_count = 2 WHERE id = ${uuid(fresh.id)}`
    // Priority = votes*3 + comments*2 + max(0, 30 - age): old 15, mid 29, fresh 36.

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect.poll(() => inboxTitles(admin, marker)).toEqual([fresh.title, mid.title, old.title])
    expect(searchParam(admin, 'sort')).toBeUndefined()
    for (const [label, sort, order] of [
      ['Oldest', 'oldest', [old, mid, fresh]],
      ['Top votes', 'votes', [old, fresh, mid]],
      ['Priority', 'priority', [fresh, mid, old]],
    ] as const) {
      await admin.getByRole('button', { name: /^Sort: / }).click()
      await admin.getByRole('menuitemradio', { name: label }).click()
      await expect.poll(() => inboxTitles(admin, marker)).toEqual(order.map((p) => p.title))
      expect(searchParam(admin, 'sort')).toBe(sort)
    }
  }
)

test(
  'FBA-I-03 Feedback cannot be switched off: a stored feedback:false is repaired and the pages stay open',
  { tag: ['@nightly', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, 'runs in product-isolated')
    // The portal home is the feedback board, so settings.types.ts resolveFeatureFlags
    // forces feedback on at read time; no product switch can turn it off.
    const admin = await asPerson('admin')
    await withSettings({ feature_flags: { feedback: false } }, async () => {
      for (const path of [
        '/admin/feedback',
        '/admin/settings/boards',
        '/admin/settings/statuses',
        '/admin/settings/tags',
        '/admin/settings/moderation',
      ]) {
        const res = await admin.goto(path)
        expect(res?.status(), path).toBeLessThan(400)
        await expect(admin, path).toHaveURL(new RegExp(`${path}$`))
      }
      await expect
        .poll(async () => {
          const [row] = await supportDb()`
            SELECT value->'featureFlags'->>'feedback' AS feedback FROM kv_store
            WHERE key = 'settings:workspace'`
          return row?.feedback
        })
        .toBe('true')
    })
  }
)

test(
  'FBA-I-07 the segment filter lists posts whose author is in the segment, with its count',
  { tag: '@nightly' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const inside = await portalCustomer(browser, `${marker}-in`)
    const outside = await portalCustomer(browser, `${marker}-out`)
    const a = await customerPost(inside, { boardId: board.id, title: `${marker} from a member` })
    await customerPost(outside, { boardId: board.id, title: `${marker} from someone else` })
    await inside.close()
    await outside.close()
    await api.dispose()
    const segment = await makeSegment(`Segment ${marker}`.slice(0, 60), [inside.principalUuid])

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect(admin.getByRole('heading', { level: 3, name: a.title })).toBeVisible({
      timeout: 15_000,
    })
    const option = admin.getByRole('button', { name: `${segment.name}, 1`, exact: true })
    await expect(option).toBeVisible()
    await option.click()
    await expectTitlesUnordered(admin, marker, [`${marker} from a member`])
    expect(searchParam(admin, 'segments')).toEqual([segment.id])
  }
)

test(
  'FBA-I-09 a created-date preset hides older posts and shows its label on the chip',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const fresh = await makePost(api, { boardId: board.id, title: `${marker} this week` })
    const old = await makePost(api, { boardId: board.id, title: `${marker} last month` })
    await api.dispose()
    await backdatePost(old.id, { createdDaysAgo: 40 })

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [fresh.title, old.title])
    await admin.getByRole('button', { name: 'Filter', exact: true }).click()
    await admin.getByRole('button', { name: 'Created date' }).click()
    await admin.getByRole('button', { name: 'Last 7 days', exact: true }).click()
    await expectTitlesUnordered(admin, marker, [fresh.title])
    expect(typeof searchParam(admin, 'dateFrom')).toBe('string')
    await expect(
      admin.getByRole('button', { name: 'Remove Date: Last 7 days filter' })
    ).toBeVisible()
  }
)

test(
  'FBA-I-10 the comment and vote thresholds keep only posts at or above them',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    test.setTimeout(60_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const none = await makePost(api, { boardId: board.id, title: `${marker} no comments` })
    const one = await makePost(api, { boardId: board.id, title: `${marker} one comment` })
    const five = await makePost(api, { boardId: board.id, title: `${marker} five comments` })
    await addComment(api, one.id, `Reply ${marker}`)
    for (let i = 0; i < 5; i++) await addComment(api, five.id, `Reply ${i} ${marker}`)
    // A private note does not count toward the comment count.
    await addComment(api, one.id, `Note ${marker}`, { isPrivate: true })
    await api.dispose()
    await supportDb()`UPDATE posts SET vote_count = 12 WHERE id = ${uuid(none.id)}`

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [none.title, one.title, five.title])
    await admin.getByRole('button', { name: 'Filter', exact: true }).click()
    await admin.getByRole('button', { name: 'Comment count' }).click()
    await admin.getByRole('button', { name: '5+ comments', exact: true }).click()
    await expectTitlesUnordered(admin, marker, [five.title])
    expect(searchParam(admin, 'minComments')).toBe('5')

    await openInbox(admin, { board: [board.id], minComments: JSON.stringify('1') })
    await expectTitlesUnordered(admin, marker, [one.title, five.title])

    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [none.title, one.title, five.title])
    await admin.getByRole('button', { name: 'Filter', exact: true }).click()
    await admin.getByRole('button', { name: 'Vote count' }).click()
    await admin.getByRole('button', { name: '10+ votes', exact: true }).click()
    await expectTitlesUnordered(admin, marker, [none.title])
  }
)

test(
  'FBA-I-16 typing the start of a word finds the post, switches to Best match, and clearing goes back',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const word = uniqueWord()
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const hit = await makePost(api, { boardId: board.id, title: `${marker} ${word} request` })
    const body = await makePost(api, {
      boardId: board.id,
      title: `${marker} body match`,
      content: `Mentions ${word} in the details`,
    })
    const miss = await makePost(api, { boardId: board.id, title: `${marker} unrelated` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expectTitlesUnordered(admin, marker, [hit.title, body.title, miss.title])
    await admin.getByPlaceholder('Search posts…').fill(word.slice(0, 7))
    await expect.poll(() => searchParam(admin, 'search')).toBe(word.slice(0, 7))
    // Title matches rank above body matches.
    await expect.poll(() => inboxTitles(admin, marker)).toEqual([hit.title, body.title])
    await expect(admin.getByRole('button', { name: 'Sort: Best match' })).toBeVisible()

    await admin.getByPlaceholder('Search posts…').fill('')
    await expect.poll(() => searchParam(admin, 'search')).toBeUndefined()
    await expectTitlesUnordered(admin, marker, [hit.title, body.title, miss.title])
    await expect(admin.getByRole('button', { name: 'Sort: Newest' })).toBeVisible()
  }
)

test(
  'FBA-I-17 a search no post fully matches widens to posts with most of the words and says so',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const [a, b, c] = [uniqueWord(), uniqueWord(), uniqueWord()]
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} ${a} ${b}` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], search: `${a} ${b} ${c}` })
    await expect(
      admin.getByText('No post has all your words. Showing posts with most of them.')
    ).toBeVisible({ timeout: 15_000 })
    await expectTitlesUnordered(admin, marker, [post.title])

    // One word never widens.
    await openInbox(admin, { board: [board.id], search: c })
    await expect(admin.getByText('No results for these filters')).toBeVisible({ timeout: 15_000 })
  }
)

test(
  'FBA-I-18 a close misspelling finds the title and says the match is by spelling',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const word = `integration${uniqueWord()}`
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} ${word}` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], search: word.replace('integration', 'integraton') })
    await expect(
      admin.getByText('No exact matches. Showing posts with a similar spelling.')
    ).toBeVisible({ timeout: 15_000 })
    await expectTitlesUnordered(admin, marker, [post.title])
  }
)

test(
  'FBA-I-20 filters that match nothing show the no-results state, and Clear all filters resets them',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await makePost(api, { boardId: board.id, title: `${marker} lonely post` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], search: uniqueWord(), sort: 'oldest' })
    await expect(admin.getByText('No results for these filters')).toBeVisible({ timeout: 15_000 })
    await expect(admin.getByText('Try adjusting your search or filter criteria.')).toBeVisible()
    await admin.getByRole('button', { name: 'Clear all filters' }).click()
    await expect.poll(() => searchParam(admin, 'board')).toBeUndefined()
    expect(searchParam(admin, 'search')).toBeUndefined()
    expect(searchParam(admin, 'sort')).toBe('oldest')
    await expect(admin.getByText('No results for these filters')).toHaveCount(0)
  }
)

test(
  'FBA-I-21 filters live in the URL: they survive a reload, a chip removes one, and a bad sort is dropped',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const word = uniqueWord()
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const match = await makePost(api, {
      boardId: board.id,
      title: `${marker} ${word} planned`,
      statusId: await statusIdBySlug('planned'),
    })
    const openOne = await makePost(api, { boardId: board.id, title: `${marker} ${word} open` })
    await makePost(api, { boardId: board.id, title: `${marker} other planned` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], status: ['planned'], search: word, sort: 'oldest' })
    await expectTitlesUnordered(admin, marker, [match.title])
    await admin.reload()
    await expectTitlesUnordered(admin, marker, [match.title])
    await expect(admin.getByRole('button', { name: 'Sort: Oldest' })).toBeVisible()

    await admin.getByRole('button', { name: 'Remove Status: Planned filter' }).click()
    await expectTitlesUnordered(admin, marker, [match.title, openOne.title])
    expect(searchParam(admin, 'board')).toEqual([board.id])
    expect(searchParam(admin, 'search')).toBe(word)

    // A leftover portal sort is dropped, not an error.
    const res = await admin.goto(
      `/admin/feedback?sort=trending&board=${encodeURIComponent(JSON.stringify([board.id]))}`
    )
    expect(res?.status()).toBeLessThan(400)
    await expect(admin.getByRole('button', { name: 'Sort: Newest' })).toBeVisible()
  }
)

test(
  'FBA-I-24 a row opens the modal with ?post=, j and k step through the rows, Escape closes it',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const first = await makePost(api, { boardId: board.id, title: `${marker} first` })
    const second = await makePost(api, { boardId: board.id, title: `${marker} second` })
    const third = await makePost(api, { boardId: board.id, title: `${marker} third` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect
      .poll(() => inboxTitles(admin, marker))
      .toEqual([third.title, second.title, first.title])
    await admin.getByRole('heading', { level: 3, name: second.title }).click()
    await expect.poll(() => searchParam(admin, 'post')).toBe(second.id)
    const dialog = admin.getByRole('dialog')
    await expect(dialog.getByText('2 / 3')).toBeVisible()
    const popup = admin.waitForEvent('popup')
    await dialog.getByRole('button', { name: 'View', exact: true }).click()
    await expect(await popup).toHaveURL(new RegExp(`/b/${board.slug}/posts/${second.id}$`))
    await (await popup).close()
    await admin.bringToFront()

    await admin.keyboard.press('j')
    await expect.poll(() => searchParam(admin, 'post')).toBe(first.id)
    await expect(dialog.getByText('3 / 3')).toBeVisible()
    await admin.keyboard.press('k')
    await admin.keyboard.press('k')
    await expect.poll(() => searchParam(admin, 'post')).toBe(third.id)
    await expect(dialog.getByText('1 / 3')).toBeVisible()

    await admin.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(searchParam(admin, 'post')).toBeUndefined()
    expect(searchParam(admin, 'board')).toEqual([board.id])
  }
)

test(
  'FBA-I-25 ?post= with a malformed id opens nothing; a deleted post offers Restore; a merged one says where it went',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const deleted = await makePost(api, { boardId: board.id, title: `${marker} deleted` })
    const canonical = await makePost(api, { boardId: board.id, title: `${marker} canonical` })
    const merged = await makePost(api, { boardId: board.id, title: `${marker} merged` })
    expect((await callServerFn(api, 'deletePostFn', { id: deleted.id })).ok).toBe(true)
    await supportDb()`UPDATE posts SET canonical_post_id = ${uuid(canonical.id)}, merged_at = now()
                      WHERE id = ${uuid(merged.id)}`
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/feedback?post=abc')
    await expect(admin.getByPlaceholder('Search posts…')).toBeVisible({ timeout: 15_000 })
    await expect(admin.getByRole('dialog').getByRole('heading')).toHaveCount(0)

    await openPost(admin, deleted.id, deleted.title)
    await expect(await manageButton(admin, 'Restore post')).toBeVisible()

    await openPost(admin, merged.id, merged.title)
    await expect(
      admin.getByRole('dialog').getByText('This feedback has been merged into')
    ).toBeVisible()
    await expect(admin.getByRole('dialog').getByText(canonical.title).first()).toBeVisible()
  }
)

test(
  'FBA-I-26 a saved view stores the filters but not the search, applies by replacing the filters, and deletes',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const planned = await makePost(api, {
      boardId: board.id,
      title: `${marker} planned`,
      statusId: await statusIdBySlug('planned'),
    })
    await makePost(api, { boardId: board.id, title: `${marker} open` })
    await api.dispose()
    const viewName = `View ${marker}`.slice(0, 80)

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], status: ['planned'], search: 'planned' })
    await expectTitlesUnordered(admin, marker, [planned.title])
    await admin.getByRole('button', { name: 'Views' }).click()
    await admin.getByRole('menuitem', { name: 'Save current filters' }).click()
    const dialog = admin.getByRole('dialog', { name: 'Save current filters as a view' })
    await dialog.getByPlaceholder('View name').fill(viewName)
    await dialog.getByRole('button', { name: 'Save view' }).click()
    await expect(dialog).toHaveCount(0)

    const row = await pollFor('the saved view row', async () => {
      const rows = await supportDb()`SELECT filters, is_shared FROM post_views
                                     WHERE name = ${viewName} AND deleted_at IS NULL`
      return rows[0]
    })
    const stored = typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters
    expect(stored).not.toHaveProperty('search')
    expect(stored).toMatchObject({ status: ['planned'], board: [board.id] })
    expect(row.is_shared).toBe(true)

    // Applying replaces the current filters (the owner filter goes away).
    await openInbox(admin, { owner: 'unassigned', minVotes: '50' })
    await admin.getByRole('button', { name: 'Views' }).click()
    await admin.getByRole('menuitem', { name: viewName }).click()
    await expectTitlesUnordered(admin, marker, [planned.title])
    expect(searchParam(admin, 'owner')).toBeUndefined()
    expect(searchParam(admin, 'minVotes')).toBeUndefined()

    await admin.getByRole('button', { name: 'Views' }).click()
    await admin.getByRole('button', { name: `Delete view ${viewName}` }).click()
    await expect
      .poll(
        async () =>
          (
            await supportDb()`SELECT 1 FROM post_views WHERE name = ${viewName}
                                            AND deleted_at IS NULL`
          ).length
      )
      .toBe(0)
    await admin.keyboard.press('Escape')
    await admin.getByRole('button', { name: 'Views' }).click()
    await expect(admin.getByRole('menuitem', { name: viewName })).toHaveCount(0)
  }
)

test(
  'FBA-I-28 slash focuses the search box and Escape blurs it',
  { tag: '@nightly' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await openInbox(admin)
    const search = admin.getByPlaceholder('Search posts…')
    await expect(search).toBeVisible({ timeout: 15_000 })
    // Retried until the page has hydrated and its key handler is listening.
    await expect(async () => {
      await admin.keyboard.press('/')
      await expect(search).toBeFocused({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await admin.keyboard.type('ab')
    await expect(search).toHaveValue('ab')
    await admin.keyboard.press('Escape')
    await expect(search).not.toBeFocused()
  }
)

test(
  'FBA-I-30 the filter pane shows a Moderation row to reviewers only, linking to the queue',
  { tag: '@nightly' },
  async ({ asPerson, browser, newTeammate, marker }) => {
    const admin = await asPerson('admin')
    await openInbox(admin)
    const row = admin.getByRole('link', { name: /^Moderation\s*\d+$/ })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveAttribute('href', '/admin/feedback/moderation')
    await row.click()
    await expect(admin).toHaveURL(/\/admin\/feedback\/moderation/)

    const roleKey = await createRole(marker, ['post.view_private', 'status.view', 'tag.view'])
    const viewer = await (await newTeammate({ roleKey })).newPage(browser)
    await openInbox(viewer)
    await expect(viewer.getByPlaceholder('Search posts…')).toBeVisible({ timeout: 15_000 })
    await expect(viewer.getByRole('link', { name: /^Moderation\s*\d+$/ })).toHaveCount(0)
  }
)

test(
  'FBA-I-32 a failed list read shows Failed to load feedback, and Try again recovers',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'feedback.index.tsx:62 Try again only resets the error boundary; the failed loader is not re-run, so the alert stays (QUARANTINE.md)',
    },
  },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/roadmap')
    await expect(admin.getByRole('heading', { name: /roadmap/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    const listUrl = `**/_serverFn/${serverFnId('fetchInboxPostsForAdmin')}**`
    await admin.route(listUrl, (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'Inbox is down' })
    )
    await admin.getByRole('link', { name: 'Feedback', exact: true }).first().click()
    await expect(admin.getByText('Failed to load feedback')).toBeVisible({ timeout: 15_000 })
    await admin.unroute(listUrl)
    await admin.getByRole('button', { name: 'Try again' }).click()
    await expect(admin.getByPlaceholder('Search posts…')).toBeVisible({ timeout: 15_000 })
  }
)

test(
  'FBA-I-27 a teammate cannot delete a colleague’s private saved view',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'post-views.service.ts:76 deletes by id only: any post.edit holder deletes any view (QUARANTINE.md)',
    },
  },
  async ({ playwright, newTeammate, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const name = `Private ${marker}`.slice(0, 80)
    const created = await callServerFn<{ id: string }>(admin, 'createPostViewFn', {
      name,
      filters: { owner: 'unassigned' },
      isShared: false,
    })
    expect(created.ok, created.raw).toBe(true)
    const viewId = created.data.id
    await admin.dispose()

    const roleKey = await createRole(marker, ['post.view_private', 'post.edit'])
    const colleague = await (await newTeammate({ roleKey })).api(playwright)
    // The view is not even listed to them...
    const listed = await callServerFn<Array<{ id: string }>>(
      colleague,
      'listPostViewsFn',
      undefined,
      {
        method: 'GET',
      }
    )
    expect(listed.ok).toBe(true)
    expect(listed.data.map((v) => v.id)).not.toContain(viewId)
    // ...so deleting it by id must be refused, and the view must survive.
    const res = await callServerFn(colleague, 'deletePostViewFn', { viewId })
    await colleague.dispose()
    const [row] = await supportDb()`SELECT deleted_at FROM post_views WHERE id = ${uuid(viewId)}`
    expect(row.deleted_at).toBeNull()
    expect(res.ok).toBe(false)
  }
)
