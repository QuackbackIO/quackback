/**
 * How posts get on and off a roadmap: the post ETA (date roadmaps), the post
 * status (column roadmaps), and the admin board's drag and drop and post modal.
 *
 * Journeys: RMP-E-01, RMP-E-02, RMP-E-04, RMP-E-05, RMP-E-08, RMP-E-10,
 * RMP-E-11, RMP-E-12, RMP-E-13, RMP-E-14, RMP-E-16, RMP-E-18.
 *
 * Date roadmaps here are filtered to the test's own board, so their periods
 * come from the test's posts alone.
 */
import type { Locator, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { waitForMail } from '../../support/mailpit'
import { callServerFn, personApi } from '../../support/server-fns'
import { waitForHydration } from '../../utils/helpers'
import { mintCustomer, portalContext } from '../../support/widget-portal'
import { deliveriesOf, bodyOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'
import {
  column,
  monYear,
  monthFromNow,
  retireRoadmaps,
  roadmapApi,
  setEta,
  type Board,
  type RoadmapApi,
} from '../../product/roadmap'

test.afterEach(async () => {
  await retireRoadmaps()
})

/** An admin board column, by its title. */
function adminColumn(page: Page, title: string): Locator {
  return page
    .locator('main')
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
}

function adminCard(scope: Locator | Page, title: string): Locator {
  return scope.locator('[aria-roledescription="draggable"]').filter({ hasText: title })
}

function adminTotal(col: Locator): Locator {
  return col.locator(':scope > div').first().locator(':scope > span')
}

/** Drag a card onto a column with the mouse (dnd-kit starts after 8px). */
async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded()
  // A drag before hydration only selects text.
  await waitForHydration(card)
  const from = await card.boundingBox()
  if (!from) throw new Error('card has no box')
  const fx = from.x + from.width / 2
  const fy = from.y + from.height / 2
  await page.mouse.move(fx, fy)
  await page.mouse.down()
  await page.mouse.move(fx + 15, fy + 15, { steps: 5 })
  const to = await target.boundingBox()
  if (!to) throw new Error('column has no box')
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(80, to.height / 2), { steps: 15 })
  await page.mouse.up()
}

async function etaOf(postId: string): Promise<string | null> {
  const [row] =
    await supportDb()`SELECT eta FROM posts WHERE id = ${toUuid(postId as `post_${string}`)}`
  return row.eta ? (row.eta as Date).toISOString() : null
}

async function statusOf(postId: string): Promise<string> {
  const [row] =
    await supportDb()`SELECT status_id FROM posts WHERE id = ${toUuid(postId as `post_${string}`)}`
  return String(row.status_id)
}

/** A team-only monthly date roadmap over one board. */
function monthlyOver(rm: RoadmapApi, marker: string, board: Board) {
  return rm.roadmap({
    name: `${marker} months`,
    visibility: 'team',
    type: 'date',
    dateSource: 'eta',
    frequency: 'monthly',
    baseFilter: { boardIds: [board.id] },
  })
}

test(
  'RMP-E-01 the team sets an ETA from the post modal and the card moves to that month',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} needs a date` })
    const far = await rm.post({ boardId: board.id, title: `${marker} far` })
    const roadmap = await monthlyOver(rm, marker, board)
    await rm.dispose()
    // A post four months out, so the board already has a column for every
    // month up to then.
    const api = await personApi(playwright, 'admin')
    await setEta(api, far.id, monthFromNow(4))
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    const card = adminCard(adminColumn(admin, 'No ETA'), post.title)
    await waitForHydration(card)
    await card.click()
    await expect(admin).toHaveURL(new RegExp(`[?&]post=${post.id}`))
    const modal = admin.getByRole('dialog')
    await modal.getByRole('button', { name: 'Set ETA' }).click()
    const target = monthFromNow(3)
    await admin.getByLabel('ETA', { exact: true }).fill(target.slice(0, 7))
    await expect(modal.getByRole('button', { name: monYear(target) })).toBeVisible()
    await expect.poll(() => etaOf(post.id)).toBe(target)

    await admin.keyboard.press('Escape')
    await expect(admin).not.toHaveURL(/[?&]post=/)
    await expect(adminCard(adminColumn(admin, monYear(target)), post.title)).toBeVisible()
    await expect(adminCard(adminColumn(admin, 'No ETA'), post.title)).toHaveCount(0)
  }
)

test(
  'RMP-E-02 a teammate clears an ETA on the portal post page and undoes it from the toast',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} dated` })
    await rm.dispose()
    const eta = monthFromNow(4)
    const api = await personApi(playwright, 'admin')
    await setEta(api, post.id, eta)
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/b/${board.slug}/posts/${post.id}`)
    await admin.getByRole('button', { name: monYear(eta) }).click()
    await admin.getByRole('button', { name: 'Clear ETA' }).click()
    const toast = admin.locator('[data-sonner-toast]').filter({ hasText: 'ETA cleared' })
    await expect(toast).toBeVisible()
    await expect.poll(() => etaOf(post.id)).toBeNull()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => etaOf(post.id)).toBe(eta)
    await expect(admin.getByRole('button', { name: monYear(eta) })).toBeVisible()
  }
)

test(
  'RMP-E-04 setting an ETA needs post.set_eta: a Contributor and a customer are refused',
  { tag: '@core' },
  async ({ browser, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} guarded` })
    await rm.dispose()
    const eta = monthFromNow(2)

    const contributor = await personApi(playwright, 'contributor')
    const denied = await callServerFn(contributor, 'setPostEtaFn', { id: post.id, eta })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('post.set_eta')
    await contributor.dispose()

    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const ctx = await portalContext(browser, customer)
    const refused = await callServerFn(ctx.request, 'setPostEtaFn', { id: post.id, eta })
    expect(refused.ok).toBe(false)
    await ctx.close()
    expect(await etaOf(post.id)).toBeNull()

    // The same call as the admin works.
    const admin = await personApi(playwright, 'admin')
    await setEta(admin, post.id, eta)
    await admin.dispose()
    expect(await etaOf(post.id)).toBe(eta)
  }
)

test(
  'RMP-E-05 an ETA shows on the portal post page, the roadmap card and the REST API',
  { tag: '@core' },
  async ({ page, asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} dated`, statusId: status.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    const eta = monthFromNow(6)
    const api = await personApi(playwright, 'admin')
    // Mid-month input: stored as the first of the month.
    await setEta(api, post.id, new Date(new Date(eta).getTime() + 14 * 86_400_000).toISOString())
    await api.dispose()

    // Visitor: a read-only chip.
    await page.goto(`/b/${board.slug}/posts/${post.id}`)
    const sidebar = page.locator('aside').filter({ hasText: 'ETA' })
    await expect(sidebar.getByText(monYear(eta), { exact: true })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: monYear(eta) })).toHaveCount(0)
    // Team on the portal: the same month, as a picker.
    const admin = await asPerson('admin')
    await admin.goto(`/b/${board.slug}/posts/${post.id}`)
    await expect(admin.getByRole('button', { name: monYear(eta) })).toBeVisible()
    // The roadmap card.
    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    await expect(page.locator('a.roadmap-card').filter({ hasText: post.title })).toContainText(
      monYear(eta)
    )

    const detail = await rm.rest.get(`/api/v1/posts/${post.id}`)
    expect((await detail.json()).data.eta).toBe(eta)
    const listed = await rm.rest.get(`/api/v1/roadmaps/${roadmap.id}/posts?statusId=${status.id}`)
    const items = (await listed.json()).data.items as Array<{ id: string; eta: string | null }>
    expect(items.find((i) => i.id === post.id)?.eta).toBe(eta)
    await rm.dispose()
  }
)

test(
  'RMP-E-08 dragging a card to another month column writes that month as the ETA',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const status = await rm.status(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} moving`,
      statusId: status.id,
    })
    // A post four months out keeps a column for every month up to then.
    const far = await rm.post({ boardId: board.id, title: `${marker} far` })
    const roadmap = await monthlyOver(rm, marker, board)
    await rm.dispose()
    const from = monthFromNow(1)
    const to = monthFromNow(3)
    const api = await personApi(playwright, 'admin')
    await setEta(api, post.id, from)
    await setEta(api, far.id, monthFromNow(4))
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await expect(adminColumn(admin, monYear(to))).toContainText(`Sets ETA to ${monYear(to)}`)
    await drag(
      admin,
      adminCard(adminColumn(admin, monYear(from)), post.title),
      adminColumn(admin, monYear(to))
    )

    await expect.poll(() => etaOf(post.id)).toBe(to)
    await expect(adminCard(adminColumn(admin, monYear(to)), post.title)).toBeVisible()
    await expect(adminCard(adminColumn(admin, monYear(from)), post.title)).toHaveCount(0)
    expect(await statusOf(post.id)).toBe(toUuid(status.id as `post_status_${string}`))
  }
)

test(
  'RMP-E-10 dragging a dated card to "No ETA" clears its ETA',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} undate me` })
    const roadmap = await monthlyOver(rm, marker, board)
    await rm.dispose()
    const eta = monthFromNow(1)
    const api = await personApi(playwright, 'admin')
    await setEta(api, post.id, eta)
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    const noEta = adminColumn(admin, 'No ETA')
    await expect(noEta).toContainText('Clears ETA')
    await drag(admin, adminCard(adminColumn(admin, monYear(eta)), post.title), noEta)
    await expect.poll(() => etaOf(post.id)).toBeNull()
    await expect(adminCard(noEta, post.title)).toBeVisible()
  }
)

test(
  'RMP-E-11 dragging between status columns changes the status and tells voters and webhooks',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker, baseURL }) => {
    const rm = await roadmapApi(playwright, people)
    const planned = await rm.status(marker, { name: `${marker} planned` })
    const building = await rm.status(marker, { name: `${marker} building` })
    const board = await rm.board(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} voted idea`,
      statusId: planned.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(planned, 0), column(building, 1)],
    })
    await rm.dispose()
    const voter = await mintCustomer({ email: `${marker}@customers.example` })
    await supportDb()`INSERT INTO post_subscriptions (id, post_id, principal_id, reason)
      VALUES (gen_random_uuid(), ${toUuid(post.id as `post_${string}`)}, ${voter.principalUuid}, 'vote')`
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.status_changed'])
    try {
      const admin = await asPerson('admin')
      await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
      const from = adminColumn(admin, planned.name)
      const to = adminColumn(admin, building.name)
      await expect(adminTotal(from)).toHaveText('1')
      await drag(admin, adminCard(from, post.title), to)

      await expect(adminCard(to, post.title)).toBeVisible()
      await expect(adminTotal(to)).toHaveText('1')
      await expect(adminTotal(from)).toHaveText('0')
      await expect
        .poll(() => statusOf(post.id))
        .toBe(toUuid(building.id as `post_status_${string}`))

      // The activity row is written after the status commits.
      await expect
        .poll(
          async () =>
            (
              await supportDb()`SELECT type FROM post_activity
                WHERE post_id = ${toUuid(post.id as `post_${string}`)} AND type = 'status.changed'`
            ).length
        )
        .toBe(1)
      const mail = await waitForMail({ to: voter.email, subject: 'A post you follow is now' })
      expect(mail.HTML).toContain(post.title)
      const [delivery] = await deliveriesOf(marker, 'post.status_changed', post.id)
      expect(bodyOf(delivery).type).toBe('post.status_changed')
    } finally {
      await unsubscribe(hooks, hook)
      await hooks.dispose()
    }
  }
)

test(
  'RMP-E-12 a refused status drag puts both columns back and says so',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const planned = await rm.status(marker, { name: `${marker} planned` })
    const building = await rm.status(marker, { name: `${marker} building` })
    const board = await rm.board(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} stuck`,
      statusId: planned.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(planned, 0), column(building, 1)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    const from = adminColumn(admin, planned.name)
    const to = adminColumn(admin, building.name)
    await expect(adminCard(from, post.title)).toBeVisible()
    // The status change answers 500.
    await admin.route('**/_serverFn/**', async (route) => {
      if (
        route.request().method() === 'POST' &&
        (route.request().postData() ?? '').includes(building.id)
      ) {
        await route.fulfill({ status: 500, body: 'boom' })
      } else {
        await route.continue()
      }
    })
    await drag(admin, adminCard(from, post.title), to)

    await expect(admin.getByText('Could not move the post. Try again.')).toBeVisible()
    await expect(adminCard(from, post.title)).toBeVisible()
    await expect(adminCard(to, post.title)).toHaveCount(0)
    await expect(adminTotal(from)).toHaveText('1')
    await expect(adminTotal(to)).toHaveText('0')
    expect(await statusOf(post.id)).toBe(toUuid(planned.id as `post_status_${string}`))
  }
)

test(
  'RMP-E-13 a status change anywhere moves the post between column roadmaps; a non-column status drops it',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const planned = await rm.status(marker, { name: `${marker} planned` })
    const building = await rm.status(marker, { name: `${marker} building` })
    const done = await rm.status(marker, { name: `${marker} done`, category: 'complete' })
    const closed = await rm.status(marker, { name: `${marker} closed`, category: 'closed' })
    const board = await rm.board(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} travelling`,
      statusId: planned.id,
    })
    const r1 = await rm.roadmap({
      name: `${marker} r1`,
      visibility: 'team',
      columns: [column(planned, 0), column(building, 1)],
    })
    const r2 = await rm.roadmap({
      name: `${marker} r2`,
      visibility: 'team',
      columns: [column(building, 0), column(done, 1)],
    })
    const admin = await personApi(playwright, 'admin')

    /** Which column (status id) of a roadmap holds the post, or null. */
    const placement = async (roadmapId: string, statuses: string[]) => {
      const res = await callServerFn<Array<{ items: Array<{ id: string }> }>>(
        admin,
        'getRoadmapColumnsFn',
        { roadmapId, limit: 20, columns: statuses.map((statusId) => ({ statusId })) },
        { method: 'GET' }
      )
      expect(res.ok, res.error).toBe(true)
      const i = res.data.findIndex((page) => page.items.some((p) => p.id === post.id))
      return i === -1 ? null : statuses[i]
    }

    expect(await placement(r1.id, [planned.id, building.id])).toBe(planned.id)
    expect(await placement(r2.id, [building.id, done.id])).toBeNull()

    await rm.setStatus(post.id, building.id)
    expect(await placement(r1.id, [planned.id, building.id])).toBe(building.id)
    expect(await placement(r2.id, [building.id, done.id])).toBe(building.id)

    await rm.setStatus(post.id, closed.id)
    expect(await placement(r1.id, [planned.id, building.id])).toBeNull()
    expect(await placement(r2.id, [building.id, done.id])).toBeNull()

    // No roadmap row changed along the way.
    const cols = await supportDb()`SELECT count(*)::int AS n FROM roadmap_columns
      WHERE roadmap_id IN (${toUuid(r1.id as `roadmap_${string}`)}, ${toUuid(r2.id as `roadmap_${string}`)})`
    expect(cols[0].n).toBe(4)
    await admin.dispose()
    await rm.dispose()
  }
)

test(
  'RMP-E-14 merged, deleted and deleted-board posts leave both views; a pending post stays off the portal',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const doomedBoard = await rm.board(marker, { name: `${marker} doomed board` })
    const keep = await rm.post({
      boardId: board.id,
      title: `${marker} canonical`,
      statusId: status.id,
    })
    const merged = await rm.post({
      boardId: board.id,
      title: `${marker} merged`,
      statusId: status.id,
    })
    const deleted = await rm.post({
      boardId: board.id,
      title: `${marker} deleted`,
      statusId: status.id,
    })
    const pending = await rm.post({
      boardId: board.id,
      title: `${marker} pending`,
      statusId: status.id,
    })
    const onDoomed = await rm.post({
      boardId: doomedBoard.id,
      title: `${marker} on doomed`,
      statusId: status.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })

    const admin = await personApi(playwright, 'admin')
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const query = { roadmapId: roadmap.id, statusId: status.id, limit: 50 }
    const adminIds = async () => {
      const res = await callServerFn<{ items: Array<{ id: string }> }>(
        admin,
        'getRoadmapPostsFn',
        query,
        { method: 'GET' }
      )
      expect(res.ok, res.error).toBe(true)
      return res.data.items.map((p) => p.id).sort()
    }
    const portalIds = async () => {
      const res = await callServerFn<{ items: Array<{ id: string }> }>(
        anonymous,
        'fetchPublicRoadmapPosts',
        query,
        { method: 'GET' }
      )
      expect(res.ok, res.error).toBe(true)
      return res.data.items.map((p) => p.id).sort()
    }
    const all = [keep.id, merged.id, deleted.id, pending.id, onDoomed.id].sort()
    expect(await adminIds()).toEqual(all)
    expect(await portalIds()).toEqual(all)

    const mergeRes = await rm.rest.post(`/api/v1/posts/${merged.id}/merge`, {
      data: { canonicalPostId: keep.id },
    })
    expect(mergeRes.status(), await mergeRes.text()).toBeLessThan(300)
    const delRes = await rm.rest.delete(`/api/v1/posts/${deleted.id}`)
    expect(delRes.status(), await delRes.text()).toBeLessThan(300)
    const boardRes = await rm.rest.delete(`/api/v1/boards/${doomedBoard.id}`)
    expect(boardRes.status(), await boardRes.text()).toBeLessThan(300)
    await supportDb()`UPDATE posts SET moderation_state = 'pending' WHERE id = ${toUuid(pending.id as `post_${string}`)}`

    const admins = await adminIds()
    expect(admins).toContain(keep.id)
    for (const gone of [merged.id, deleted.id, onDoomed.id]) expect(admins).not.toContain(gone)
    expect(await portalIds()).toEqual([keep.id])
    await anonymous.dispose()
    await admin.dispose()
    await rm.dispose()
  }
)

test(
  'RMP-E-16 deleting a status takes its column off every roadmap that used it',
  { tag: '@nightly' },
  async ({ playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const keep = await rm.status(marker, { name: `${marker} keep` })
    const doomed = await rm.status(marker, { name: `${marker} doomed` })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(keep, 0), column(doomed, 1)],
    })
    const del = await rm.rest.delete(`/api/v1/statuses/${doomed.id}`)
    expect(del.status(), await del.text()).toBeLessThan(300)
    const [row] =
      await supportDb()`SELECT deleted_at FROM post_statuses WHERE id = ${toUuid(doomed.id as `post_status_${string}`)}`
    expect(row.deleted_at).not.toBeNull()

    const admin = await personApi(playwright, 'admin')
    const res = await callServerFn<{ columns: Array<{ statusId: string; name: string }> }>(
      admin,
      'fetchRoadmap',
      { id: roadmap.id },
      { method: 'GET' }
    )
    expect(res.data.columns.map((c) => c.name)).toEqual([keep.name])
    await admin.dispose()
    await rm.dispose()
  }
)

test(
  'RMP-E-18 a card opens the post modal; a status change there moves the card; Escape closes it',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const planned = await rm.status(marker, { name: `${marker} planned` })
    const building = await rm.status(marker, { name: `${marker} building` })
    const board = await rm.board(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} modal idea`,
      statusId: planned.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(planned, 0), column(building, 1)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    const card = adminCard(adminColumn(admin, planned.name), post.title)
    await waitForHydration(card)
    await card.click()
    await expect(admin).toHaveURL(new RegExp(`[?&]post=${post.id}`))
    const modal = admin.getByRole('dialog').filter({ hasText: post.title })
    await expect(modal.getByRole('heading', { name: post.title })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Set ETA' })).toBeVisible()
    await modal.getByRole('button', { name: planned.name }).click()
    await admin.getByRole('button', { name: building.name, exact: true }).click()
    await expect.poll(() => statusOf(post.id)).toBe(toUuid(building.id as `post_status_${string}`))

    await admin.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(admin).not.toHaveURL(/[?&]post=/)
    await expect(adminCard(adminColumn(admin, building.name), post.title)).toBeVisible()
    await expect(adminCard(adminColumn(admin, planned.name), post.title)).toHaveCount(0)
  }
)
