/**
 * The portal roadmap (/roadmap) as visitors, customers and the team see it.
 *
 * Journeys: RMP-P-01, RMP-P-02, RMP-P-04, RMP-P-05, RMP-P-06,
 * RMP-P-07, RMP-P-08, RMP-P-09 (@isolated), RMP-P-11, RMP-P-12, RMP-P-14,
 * RMP-P-15, RMP-P-16.
 *
 * Every test makes its own status, board, posts and roadmap (named with its
 * marker) and finds them by name; roadmaps are soft-deleted afterwards.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { withSettings } from '../../support/isolated-settings'
import { mintCustomer, portalContext, portalPage } from '../../support/widget-portal'
import {
  column,
  columnBadge,
  monYear,
  monthFromNow,
  portalColumn,
  retireRoadmaps,
  roadmapApi,
  roadmapCard,
  segmentWith,
  setEta,
} from '../../product/roadmap'
import { callServerFn, personApi } from '../../support/server-fns'

test.afterEach(async () => {
  await retireRoadmaps()
})

async function workspaceName(): Promise<string> {
  const [row] = await supportDb()`SELECT name FROM settings LIMIT 1`
  return String(row.name)
}

test(
  'RMP-P-01 an anonymous visitor sees a public roadmap: columns, totals and card content',
  { tag: '@smoke' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const planned = await rm.status(marker, { name: `${marker} planned` })
    const building = await rm.status(marker, { name: `${marker} building` })
    const board = await rm.board(marker)
    const first = await rm.post({
      boardId: board.id,
      title: `${marker} first idea`,
      statusId: planned.id,
    })
    const second = await rm.post({
      boardId: board.id,
      title: `${marker} second idea`,
      statusId: planned.id,
    })
    await rm.post({ boardId: board.id, title: `${marker} third idea`, statusId: building.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(planned, 0), column(building, 1)],
    })
    await rm.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible()
    await expect(page.getByText("See what we're working on and what's coming next.")).toBeVisible()
    await expect(page).toHaveTitle(`Roadmap - ${await workspaceName()}`)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/roadmap$/)

    const plannedCol = portalColumn(page, planned.name)
    const buildingCol = portalColumn(page, building.name)
    await expect(columnBadge(plannedCol)).toHaveText('2')
    await expect(columnBadge(buildingCol)).toHaveText('1')
    await expect(roadmapCard(plannedCol, first.title)).toBeVisible()
    await expect(roadmapCard(plannedCol, second.title)).toBeVisible()
    await expect(roadmapCard(buildingCol, `${marker} third idea`)).toBeVisible()
    await expect(roadmapCard(plannedCol, `${marker} third idea`)).toHaveCount(0)

    const card = roadmapCard(plannedCol, first.title)
    await expect(card).toHaveAttribute('href', `/b/${board.slug}/posts/${first.id}`)
    await expect(card.locator('.roadmap-card__vote')).toHaveText(String(first.voteCount))
    await expect(card).toContainText(board.name)
    // No comments yet: no comment count; no ETA: no chip.
    await expect(card.getByTestId('roadmap-card-comment-count')).toHaveCount(0)
    await expect(card.locator('[data-slot="badge"]')).toHaveCount(1)
  }
)

test(
  'RMP-P-02 a roadmap card shows its ETA as "Mon YYYY", and none without one',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const dated = await rm.post({
      boardId: board.id,
      title: `${marker} dated`,
      statusId: status.id,
    })
    const undated = await rm.post({
      boardId: board.id,
      title: `${marker} undated`,
      statusId: status.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()
    const eta = monthFromNow(5)
    const admin = await personApi(playwright, 'admin')
    await setEta(admin, dated.id, eta)
    await admin.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    const col = portalColumn(page, status.name)
    await expect(roadmapCard(col, dated.title)).toContainText(monYear(eta))
    await expect(roadmapCard(col, dated.title).locator('[data-slot="badge"]')).toHaveCount(2)
    await expect(roadmapCard(col, undated.title)).toBeVisible()
    await expect(roadmapCard(col, undated.title).locator('[data-slot="badge"]')).toHaveCount(1)
  }
)

test(
  'RMP-P-04 tabs switch roadmaps and ?roadmap= deep-links one',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const s1 = await rm.status(marker, { name: `${marker} first col` })
    const s2 = await rm.status(marker, { name: `${marker} second col` })
    const one = await rm.roadmap({
      name: `${marker} one`,
      visibility: 'public',
      columns: [column(s1)],
    })
    const two = await rm.roadmap({
      name: `${marker} two`,
      visibility: 'public',
      columns: [column(s2)],
    })
    await rm.dispose()

    // No param: the first roadmap is written into the URL by replace-navigation.
    await page.goto('/roadmap')
    await expect(page).toHaveURL(/[?&]roadmap=roadmap_/)

    await page.goto(`/roadmap?roadmap=${one.id}`)
    await expect(page.getByRole('tab', { name: one.name })).toHaveAttribute('aria-selected', 'true')
    await expect(portalColumn(page, s1.name)).toBeVisible()
    await page.getByRole('tab', { name: two.name }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]roadmap=${two.id}`))
    await expect(page.getByRole('tab', { name: two.name })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: one.name })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    await expect(portalColumn(page, s2.name)).toBeVisible()
    await expect(portalColumn(page, s1.name)).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('tab', { name: two.name })).toHaveAttribute('aria-selected', 'true')
    await expect(portalColumn(page, s2.name)).toBeVisible()
  }
)

test(
  'RMP-P-06 a team-only roadmap is hidden from visitors and customers and shown to the team',
  { tag: '@core' },
  async ({ page, browser, asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const open = await rm.roadmap({
      name: `${marker} open`,
      visibility: 'public',
      columns: [column(status)],
    })
    const team = await rm.roadmap({
      name: `${marker} team`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()

    await page.goto('/roadmap')
    await expect(page.getByRole('tab', { name: open.name })).toBeVisible()
    await expect(page.getByRole('tab', { name: team.name })).toHaveCount(0)

    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const customerPage = await portalPage(browser, customer)
    await customerPage.goto('/roadmap')
    await expect(customerPage.getByRole('tab', { name: open.name })).toBeVisible()
    await expect(customerPage.getByRole('tab', { name: team.name })).toHaveCount(0)
    await customerPage.context().close()

    const admin = await asPerson('admin')
    await admin.goto('/roadmap')
    await expect(admin.getByRole('tab', { name: open.name })).toBeVisible()
    await expect(admin.getByRole('tab', { name: team.name })).toBeVisible()
  }
)

test(
  'RMP-P-07 a segment roadmap shows only to signed-in members of a listed segment',
  { tag: '@core' },
  async ({ page, browser, playwright, people, marker }) => {
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const outsider = await mintCustomer({ email: `${marker}-out@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const open = await rm.roadmap({
      name: `${marker} open`,
      visibility: 'public',
      columns: [column(status)],
    })
    const vip = await rm.roadmap({
      name: `${marker} vip`,
      visibility: 'segment',
      visibleSegmentIds: [segment],
      columns: [column(status)],
    })
    await rm.dispose()

    const memberPage = await portalPage(browser, member)
    await memberPage.goto('/roadmap')
    await expect(memberPage.getByRole('tab', { name: vip.name })).toBeVisible()
    await memberPage.context().close()

    const outsiderPage = await portalPage(browser, outsider)
    await outsiderPage.goto('/roadmap')
    await expect(outsiderPage.getByRole('tab', { name: open.name })).toBeVisible()
    await expect(outsiderPage.getByRole('tab', { name: vip.name })).toHaveCount(0)
    await outsiderPage.context().close()

    await page.goto('/roadmap')
    await expect(page.getByRole('tab', { name: open.name })).toBeVisible()
    await expect(page.getByRole('tab', { name: vip.name })).toHaveCount(0)
  }
)

test(
  'RMP-P-08 every portal read of a hidden or deleted roadmap answers ROADMAP_NOT_FOUND',
  { tag: '@core' },
  async ({ browser, playwright, people, marker }) => {
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const outsider = await mintCustomer({ email: `${marker}-out@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const rm = await roadmapApi(playwright, people)
    // Date roadmaps, so the bucket read reaches its visibility check too (a
    // column roadmap answers an empty bucket list before checking).
    const dated = { type: 'date', dateSource: 'eta', frequency: 'monthly' }
    const team = await rm.roadmap({ name: `${marker} team`, visibility: 'team', ...dated })
    const vip = await rm.roadmap({
      name: `${marker} vip`,
      visibility: 'segment',
      visibleSegmentIds: [segment],
      ...dated,
    })
    const gone = await rm.roadmap({ name: `${marker} gone`, visibility: 'public', ...dated })
    await rm.dispose()
    await supportDb()`UPDATE roadmaps SET deleted_at = now() WHERE id = ${toUuid(gone.id as `roadmap_${string}`)}`

    const reads = (roadmapId: string): Array<[string, unknown]> => [
      ['fetchPublicRoadmapPosts', { roadmapId, bucketId: 'no-eta', limit: 20 }],
      ['fetchPublicRoadmapColumns', { roadmapId, limit: 20, columns: [{ bucketId: 'no-eta' }] }],
      ['fetchPublicRoadmapDateBuckets', { roadmapId }],
    ]
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const outsiderCtx = await portalContext(browser, outsider)
    const memberCtx = await portalContext(browser, member)
    for (const [who, api] of [
      ['anonymous', anonymous],
      ['outsider', outsiderCtx.request],
    ] as const) {
      for (const id of [team.id, vip.id, gone.id]) {
        for (const [fn, data] of reads(id)) {
          const res = await callServerFn(api, fn, data, { method: 'GET' })
          expect(res.code, `${who} ${fn} ${id}`).toBe('ROADMAP_NOT_FOUND')
        }
      }
    }
    // The member reads the segment roadmap: the same calls work for a viewer who may see it.
    for (const [fn, data] of reads(vip.id)) {
      const ok = await callServerFn(memberCtx.request, fn, data, { method: 'GET' })
      expect(ok.ok, `member ${fn}: ${ok.error}`).toBe(true)
    }
    await anonymous.dispose()
    await outsiderCtx.close()
    await memberCtx.close()
  }
)

test(
  'RMP-P-09 a private portal gives a signed-out caller no roadmaps and no posts',
  { tag: ['@core', '@isolated'] },
  async ({ page, playwright, people, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    await rm.post({ boardId: board.id, title: `${marker} idea`, statusId: status.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const postsQuery = { roadmapId: roadmap.id, statusId: status.id, limit: 20 }
    const columnsQuery = { roadmapId: roadmap.id, limit: 20, columns: [{ statusId: status.id }] }

    // Control: on a public portal the same calls answer with the roadmap and its post.
    await withSettings({ portal_config: { 'access.visibility': 'public' } }, async () => {
      const list = await callServerFn<Array<{ id: string }>>(
        anonymous,
        'fetchPublicRoadmaps',
        undefined,
        {
          method: 'GET',
        }
      )
      expect(list.data.map((r) => r.id)).toContain(roadmap.id)
      const posts = await callServerFn<{ total: number }>(
        anonymous,
        'fetchPublicRoadmapPosts',
        postsQuery,
        {
          method: 'GET',
        }
      )
      expect(posts.data.total).toBe(1)
    })

    await withSettings({ portal_config: { 'access.visibility': 'private' } }, async () => {
      const list = await callServerFn(anonymous, 'fetchPublicRoadmaps', undefined, {
        method: 'GET',
      })
      expect(list.data).toEqual([])
      const posts = await callServerFn(anonymous, 'fetchPublicRoadmapPosts', postsQuery, {
        method: 'GET',
      })
      expect(posts.data).toEqual({ items: [], hasMore: false, total: 0 })
      const cols = await callServerFn(anonymous, 'fetchPublicRoadmapColumns', columnsQuery, {
        method: 'GET',
      })
      expect(cols.data).toEqual([{ items: [], hasMore: false, total: 0 }])
      const buckets = await callServerFn(
        anonymous,
        'fetchPublicRoadmapDateBuckets',
        { roadmapId: roadmap.id },
        { method: 'GET' }
      )
      expect(buckets.data).toEqual([])

      await page.goto(`/roadmap?roadmap=${roadmap.id}`)
      await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toHaveCount(0)
      await expect(roadmapCard(page, `${marker} idea`)).toHaveCount(0)
    })
    await anonymous.dispose()
  }
)

test(
  'RMP-P-14 clicking a roadmap card opens the post page with its status',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const post = await rm.post({
      boardId: board.id,
      title: `${marker} clickable`,
      statusId: status.id,
    })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    await roadmapCard(portalColumn(page, status.name), post.title).click()
    await expect(page).toHaveURL(new RegExp(`/b/${board.slug}/posts/${post.id}$`))
    await expect(page.getByRole('heading', { name: post.title })).toBeVisible()
    await expect(page.getByText(status.name).first()).toBeVisible()
  }
)

test(
  'RMP-P-15 a monthly date roadmap shows period columns and No ETA last, each post in its period',
  { tag: '@core' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const soon = await rm.post({ boardId: board.id, title: `${marker} soon` })
    const later = await rm.post({ boardId: board.id, title: `${marker} later` })
    const none = await rm.post({ boardId: board.id, title: `${marker} none` })
    // Only this test's board, so the periods come from these posts alone.
    const roadmap = await rm.roadmap({
      name: `${marker} months`,
      visibility: 'public',
      type: 'date',
      dateSource: 'eta',
      frequency: 'monthly',
      baseFilter: { boardIds: [board.id] },
    })
    await rm.dispose()
    const admin = await personApi(playwright, 'admin')
    const soonEta = monthFromNow(2)
    const laterEta = monthFromNow(14)
    await setEta(admin, soon.id, soonEta)
    await setEta(admin, later.id, laterEta)
    await admin.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    const titles = page.locator('[data-slot="card-title"]')
    // From the current month to the latest ETA, one column each, then No ETA.
    await expect(titles).toHaveCount(16)
    await expect(titles.first()).toHaveText(monYear(monthFromNow(0)))
    await expect(titles.nth(14)).toHaveText(monYear(laterEta))
    await expect(titles.last()).toHaveText('No ETA')
    await expect(roadmapCard(portalColumn(page, monYear(soonEta)), soon.title)).toBeVisible()
    await expect(columnBadge(portalColumn(page, monYear(soonEta)))).toHaveText('1')
    await expect(columnBadge(portalColumn(page, monYear(monthFromNow(1))))).toHaveText('0')
    const noEta = portalColumn(page, 'No ETA')
    await noEta.scrollIntoViewIfNeeded()
    await expect(roadmapCard(noEta, none.title)).toBeVisible()
    await expect(roadmapCard(noEta, soon.title)).toHaveCount(0)
    const laterCol = portalColumn(page, monYear(laterEta))
    await laterCol.scrollIntoViewIfNeeded()
    await expect(roadmapCard(laterCol, later.title)).toBeVisible()
  }
)

test(
  'RMP-P-16 an empty column says "No items yet" with a zero total',
  { tag: '@nightly' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const full = await rm.status(marker, { name: `${marker} full` })
    const empty = await rm.status(marker, { name: `${marker} empty` })
    const board = await rm.board(marker)
    await rm.post({ boardId: board.id, title: `${marker} idea`, statusId: full.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(full, 0), column(empty, 1)],
    })
    await rm.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    await expect(roadmapCard(portalColumn(page, full.name), `${marker} idea`)).toBeVisible()
    const col = portalColumn(page, empty.name)
    await expect(col.getByText('No items yet')).toBeVisible()
    await expect(columnBadge(col)).toHaveText('0')
    await expect(portalColumn(page, full.name).getByText('No items yet')).toHaveCount(0)
  }
)

test(
  'RMP-P-05 a ?roadmap= id the visitor cannot see falls back to a roadmap they can',
  { tag: '@nightly' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const hidden = await rm.roadmap({
      name: `${marker} team`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()

    await page.goto(`/roadmap?roadmap=${hidden.id}`)
    await expect(page.getByRole('tablist', { name: 'Roadmaps' })).toBeVisible()
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1)
    await expect(page.locator('[data-slot="card-title"]').first()).toBeVisible()
  }
)

test(
  'RMP-P-11 a column shows 20 cards, loads the rest on scroll, and its badge shows the total',
  { tag: '@nightly' },
  async ({ page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const titles: string[] = []
    for (let i = 1; i <= 25; i++) {
      const title = `${marker} item ${String(i).padStart(2, '0')}`
      await rm.post({ boardId: board.id, title, statusId: status.id })
      titles.push(title)
    }
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()

    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    const col = portalColumn(page, status.name)
    await expect(columnBadge(col)).toHaveText('25')
    const cards = col.locator('a.roadmap-card')
    await expect(cards).toHaveCount(20)
    await cards.last().scrollIntoViewIfNeeded()
    await expect(cards).toHaveCount(25)
    const shown = await cards.locator('p').allTextContents()
    expect(new Set(shown).size).toBe(25)
    expect([...shown].sort()).toEqual([...titles].sort())
  }
)

test(
  'RMP-P-12 portal filters narrow the board; segment filters apply only for the team',
  { tag: '@nightly' },
  async ({ page, browser, playwright, people, marker }) => {
    const author = await mintCustomer({ email: `${marker}-author@customers.example` })
    const segment = await segmentWith(marker, [author.principalUuid])
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const boardA = await rm.board(marker, { name: `${marker} board a` })
    const boardB = await rm.board(marker, { name: `${marker} board b` })
    const tagRes = await rm.rest.post('/api/v1/tags', {
      data: { name: `${marker.slice(-20)} tag`, color: '#22c55e', isPublic: true },
    })
    expect(tagRes.status(), await tagRes.text()).toBe(201)
    const tag = (await tagRes.json()).data as { id: string }
    const apple = await rm.post({
      boardId: boardA.id,
      title: `${marker} apple`,
      statusId: status.id,
    })
    const banana = await rm.post({
      boardId: boardB.id,
      title: `${marker} banana`,
      statusId: status.id,
      tagIds: [tag.id],
    })
    const cherry = await rm.post({
      boardId: boardA.id,
      title: `${marker} cherry`,
      statusId: status.id,
    })
    await supportDb()`UPDATE posts SET principal_id = ${author.principalUuid}
      WHERE id = ${toUuid(cherry.id as `post_${string}`)}`
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()

    const list = (id: string) => encodeURIComponent(JSON.stringify([id]))
    const base = `/roadmap?roadmap=${roadmap.id}`
    const shown = async () => {
      const col = portalColumn(page, status.name)
      await expect(col.locator('a.roadmap-card').first()).toBeVisible()
      return col.locator('a.roadmap-card p').allTextContents()
    }
    await page.goto(`${base}&search=${encodeURIComponent(`${marker} banana`)}`)
    await expect.poll(shown).toEqual([banana.title])
    await page.goto(`${base}&board=${list(boardA.id)}`)
    await expect
      .poll(async () => (await shown()).sort())
      .toEqual([apple.title, cherry.title].sort())
    await page.goto(`${base}&tags=${list(tag.id)}`)
    await expect.poll(shown).toEqual([banana.title])
    await page.goto(`${base}&sort=newest`)
    await expect.poll(shown).toEqual([cherry.title, banana.title, apple.title])
    await page.goto(`${base}&sort=oldest`)
    await expect.poll(shown).toEqual([apple.title, banana.title, cherry.title])

    // segmentIds: ignored for a customer, applied for the team.
    const query = { roadmapId: roadmap.id, statusId: status.id, limit: 20, segmentIds: [segment] }
    const ids = (r: { data: { items: Array<{ id: string }> } }) =>
      r.data.items.map((p) => p.id).sort()
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const ctx = await portalContext(browser, customer)
    const asCustomer = await callServerFn<{ items: Array<{ id: string }> }>(
      ctx.request,
      'fetchPublicRoadmapPosts',
      query,
      { method: 'GET' }
    )
    expect(ids(asCustomer)).toEqual([apple.id, banana.id, cherry.id].sort())
    await ctx.close()
    const admin = await personApi(playwright, 'admin')
    const asTeam = await callServerFn<{ items: Array<{ id: string }> }>(
      admin,
      'fetchPublicRoadmapPosts',
      query,
      { method: 'GET' }
    )
    expect(ids(asTeam)).toEqual([cherry.id])
    await admin.dispose()
  }
)
