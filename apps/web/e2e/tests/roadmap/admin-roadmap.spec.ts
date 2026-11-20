/**
 * The admin roadmap board (/admin/roadmap): the roadmap list, create, edit,
 * delete, columns, and who may open it.
 *
 * Journeys: RMP-A-01, RMP-A-02, RMP-A-03, RMP-A-04, RMP-A-07, RMP-A-09,
 * RMP-A-10, RMP-A-11, RMP-A-14, RMP-A-15, RMP-A-16 (quarantined), RMP-A-18,
 * RMP-A-20, RMP-A-21.
 *
 * Every roadmap a test makes carries its marker and is soft-deleted
 * afterwards; posts sit in a status the test made, so a column's contents and
 * total are the test's own.
 */
import type { Locator, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { callServerFn, personApi } from '../../support/server-fns'
import { mintCustomer, portalContext } from '../../support/widget-portal'
import { waitForHydration } from '../../utils/helpers'
import {
  column,
  monthFromNow,
  retireRoadmaps,
  roadmapApi,
  roadmapCard,
  segmentWith,
  setEta,
  slugOf,
  trackRoadmap,
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

/** A card on the admin board (a draggable button), by post title. */
function adminCard(scope: Locator, title: string): Locator {
  return scope.locator('[aria-roledescription="draggable"]').filter({ hasText: title })
}

/** The total shown in an admin column header. */
function adminTotal(col: Locator): Locator {
  return col.locator(':scope > div').first().locator(':scope > span')
}

/** A roadmap row in the admin sidebar. */
function sidebarRow(page: Page, name: string): Locator {
  return page
    .locator('aside[data-side-pane]')
    .locator('div.group')
    .filter({ has: page.getByText(name, { exact: true }) })
}

/** Open a roadmap's kebab menu and pick an item (retried until the menu opens: hydration). */
async function rowMenu(page: Page, name: string, item: 'Edit' | 'Delete'): Promise<void> {
  const row = sidebarRow(page, name)
  const menuItem = page.getByRole('menuitem', { name: item })
  await expect(async () => {
    await row.hover()
    await row.getByRole('button').click()
    await expect(menuItem).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await menuItem.click()
}

/** Open the Create roadmap dialog (retried until it opens: hydration). */
async function openCreate(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Create roadmap' })
  await expect(async () => {
    await page.getByRole('button', { name: 'New roadmap' }).click()
    await expect(dialog).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}

async function roadmapRow(id: string) {
  const [row] =
    await supportDb()`SELECT * FROM roadmaps WHERE id = ${toUuid(id as `roadmap_${string}`)}`
  return row
}

async function columnStatuses(id: string): Promise<string[]> {
  const rows = await supportDb()`SELECT status_id, name, icon, color, position FROM roadmap_columns
    WHERE roadmap_id = ${toUuid(id as `roadmap_${string}`)} ORDER BY position`
  return rows.map((r) => String(r.status_id))
}

test(
  'RMP-A-01 the board shows a column per configured status with its total and the posts in it',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const a = await rm.status(marker, { name: `${marker} alpha` })
    const b = await rm.status(marker, { name: `${marker} beta` })
    const empty = await rm.status(marker, { name: `${marker} gamma` })
    const board = await rm.board(marker)
    const p1 = await rm.post({ boardId: board.id, title: `${marker} one`, statusId: a.id })
    const p2 = await rm.post({ boardId: board.id, title: `${marker} two`, statusId: a.id })
    const p3 = await rm.post({ boardId: board.id, title: `${marker} three`, statusId: b.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(empty, 0), column(a, 1), column(b, 2)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await expect(admin.getByRole('heading', { name: roadmap.name })).toBeVisible()

    // Columns in position order.
    const titles = admin.locator('main').getByText(new RegExp(`^${marker} (alpha|beta|gamma)$`))
    await expect(titles).toHaveText([empty.name, a.name, b.name])

    const colA = adminColumn(admin, a.name)
    await expect(adminTotal(colA)).toHaveText('2')
    await expect(adminCard(colA, p1.title)).toBeVisible()
    await expect(adminCard(colA, p2.title)).toBeVisible()
    await expect(adminCard(colA, p3.title)).toHaveCount(0)
    const colB = adminColumn(admin, b.name)
    await expect(adminTotal(colB)).toHaveText('1')
    await expect(adminCard(colB, p3.title)).toBeVisible()

    // The first column is empty and carries the one action.
    const colEmpty = adminColumn(admin, empty.name)
    await expect(adminTotal(colEmpty)).toHaveText('0')
    await expect(colEmpty.getByText('No posts here yet')).toBeVisible()
    await expect(colEmpty.getByRole('link', { name: 'Move a post onto the roadmap' })).toBeVisible()
  }
)

test(
  'RMP-A-03 creating a roadmap with a name only gives a public status-column roadmap seen on the portal',
  { tag: '@core' },
  async ({ asPerson, page, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/roadmap')
    const dialog = await openCreate(admin)
    await expect(
      dialog.getByText('Define a saved view over posts using statuses or ETA periods.')
    ).toBeVisible()
    const name = `${marker} Launch Plan`
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByRole('button', { name: 'Create roadmap' }).click()
    await expect(dialog).toBeHidden()

    await expect(admin).toHaveURL(/[?&]roadmap=roadmap_/)
    const id = new URL(admin.url()).searchParams.get('roadmap')!
    trackRoadmap(id)
    await expect(sidebarRow(admin, name)).toBeVisible()
    await expect(admin.getByRole('heading', { name })).toBeVisible()

    const row = await roadmapRow(id)
    expect(row).toMatchObject({
      name,
      slug: slugOf(name),
      type: 'column',
      visibility: 'public',
      date_source: null,
      frequency: null,
    })
    // Columns default to the statuses marked "show on roadmap", named and coloured like them.
    const columns = await supportDb()`
      SELECT c.name AS column_name, c.color AS column_color, s.name, s.color, s.show_on_roadmap
      FROM roadmap_columns c JOIN post_statuses s ON s.id = c.status_id
      WHERE c.roadmap_id = ${toUuid(id as `roadmap_${string}`)}`
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(c.show_on_roadmap).toBe(true)
      expect(c.column_name).toBe(c.name)
      expect(c.column_color).toBe(c.color)
    }
    const seedShown = await supportDb()`SELECT name FROM post_statuses
      WHERE show_on_roadmap AND deleted_at IS NULL AND slug IN ('planned', 'in_progress', 'complete')`
    expect(columns.map((c) => c.name)).toEqual(expect.arrayContaining(seedShown.map((s) => s.name)))

    // The anonymous portal lists it as a tab.
    await page.goto('/roadmap')
    await expect(page.getByRole('tab', { name })).toBeVisible()
  }
)

test(
  'RMP-A-04 a roadmap whose slug is taken is refused with DUPLICATE_SLUG',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const slug = slugOf(`${marker} launch plan`)
    const first = await callServerFn<{ id: string }>(admin, 'createRoadmapFn', {
      name: `${marker} Launch plan`,
      slug,
      visibility: 'team',
    })
    expect(first.ok, first.error).toBe(true)
    trackRoadmap(first.data.id)

    const second = await callServerFn(admin, 'createRoadmapFn', {
      name: `${marker} Launch Plan`,
      slug,
      visibility: 'team',
    })
    expect(second.ok).toBe(false)
    expect(second.code).toBe('DUPLICATE_SLUG')
    // The raw answer carries the message JSON-escaped.
    expect(second.error).toMatch(new RegExp(`A roadmap with slug \\W*${slug}\\W* already exists`))
    const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM roadmaps WHERE slug = ${slug}`
    expect(n).toBe(1)
    await admin.dispose()
  }
)

test(
  'RMP-A-07 a date roadmap with a quarterly frequency shows periods and a final No ETA column',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/roadmap')
    const dialog = await openCreate(admin)
    const name = `${marker} quarters`
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Layout', { exact: true }).selectOption('date')
    await dialog.getByLabel('Frequency', { exact: true }).selectOption('quarterly')
    await dialog.getByLabel('Visibility', { exact: true }).selectOption('team')
    await dialog.getByRole('button', { name: 'Create roadmap' }).click()
    await expect(dialog).toBeHidden()
    await expect(admin).toHaveURL(/[?&]roadmap=roadmap_/)
    const id = new URL(admin.url()).searchParams.get('roadmap')!
    trackRoadmap(id)

    const row = await roadmapRow(id)
    expect(row).toMatchObject({ type: 'date', date_source: 'eta', frequency: 'quarterly' })
    expect(await columnStatuses(id)).toEqual([])

    // The current quarter is always a column, labelled "Q<n> <year>" and
    // setting the ETA to the quarter's last month; No ETA comes last.
    const now = new Date()
    const q = Math.floor(now.getUTCMonth() / 3)
    const label = `Q${q + 1} ${now.getUTCFullYear()}`
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 2, 1)).toLocaleDateString(
      'en-US',
      { month: 'short', year: 'numeric', timeZone: 'UTC' }
    )
    const current = adminColumn(admin, label)
    await expect(current).toContainText(`Sets ETA to ${lastMonth}`)
    const noEta = adminColumn(admin, 'No ETA')
    await expect(noEta).toContainText('Clears ETA')
    const titles = admin.locator('main .rounded-xl span.text-sm.font-medium')
    await expect(titles.last()).toHaveText('No ETA')

    // A post with an ETA two quarters out widens the range to that quarter.
    const rm = await roadmapApi(playwright, people)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} later` })
    await rm.dispose()
    const api = await personApi(playwright, 'admin')
    const eta = monthFromNow(7)
    await setEta(api, post.id, eta)
    await api.dispose()
    const etaDate = new Date(eta)
    const laterLabel = `Q${Math.floor(etaDate.getUTCMonth() / 3) + 1} ${etaDate.getUTCFullYear()}`
    await admin.reload()
    await expect(adminCard(adminColumn(admin, laterLabel), post.title)).toBeVisible()
  }
)

test(
  'RMP-A-09 editing name, description and visibility shows on the board, the sidebar and the portal',
  { tag: '@core' },
  async ({ asPerson, page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const roadmap = await rm.roadmap({
      name: `${marker} before`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()

    // Public first: the anonymous portal lists it.
    await page.goto('/roadmap')
    await expect(page.getByRole('tab', { name: roadmap.name })).toBeVisible()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await expect(sidebarRow(admin, roadmap.name).locator('svg')).toHaveCount(2) // map + kebab, no lock
    await rowMenu(admin, roadmap.name, 'Edit')
    const dialog = admin.getByRole('dialog', { name: 'Edit roadmap' })
    const name = `${marker} after`
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Description', { exact: true }).fill(`${marker} what ships next`)
    await dialog.getByLabel('Visibility', { exact: true }).selectOption('team')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()

    await expect(admin.getByRole('heading', { name })).toBeVisible()
    await expect(admin.getByText(`${marker} what ships next`)).toBeVisible()
    // A lock now marks the non-public roadmap.
    await expect(sidebarRow(admin, name).locator('svg')).toHaveCount(3)
    const row = await roadmapRow(roadmap.id)
    expect(row).toMatchObject({ name, visibility: 'team', slug: roadmap.slug })

    await page.goto('/roadmap')
    await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: roadmap.name })).toHaveCount(0)
  }
)

test(
  'RMP-A-11 the column editor renames, sets an icon and colour, reorders and drops a status',
  { tag: '@core' },
  async ({ asPerson, page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const a = await rm.status(marker, { name: `${marker} alpha` })
    const b = await rm.status(marker, { name: `${marker} beta` })
    const c = await rm.status(marker, { name: `${marker} gamma` })
    const board = await rm.board(marker)
    const inC = await rm.post({ boardId: board.id, title: `${marker} in gamma`, statusId: c.id })
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'public',
      columns: [column(a, 0), column(b, 1), column(c, 2)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await rowMenu(admin, roadmap.name, 'Edit')
    const dialog = admin.getByRole('dialog', { name: 'Edit roadmap' })
    await expect(
      dialog.getByText('Each status can appear once. Dragging a card changes only its status.')
    ).toBeVisible()
    // Untick gamma; rename beta "Next up", give it an icon and a colour, move it left.
    // (The base-filter Statuses group lists it too, unticked.)
    await dialog
      .locator('label')
      .filter({ hasText: c.name })
      .getByRole('checkbox', { checked: true })
      .click()
    await dialog.getByLabel(`${b.name} column name`).fill(`${marker} Next up`)
    await dialog.getByLabel(`${b.name} column icon`).fill('🚀')
    await dialog.getByLabel(`${b.name} column color`).fill('#ef4444')
    await dialog.getByRole('button', { name: `Move ${b.name} left` }).click()
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()

    const rows =
      await supportDb()`SELECT status_id, name, icon, color, position FROM roadmap_columns
      WHERE roadmap_id = ${toUuid(roadmap.id as `roadmap_${string}`)} ORDER BY position`
    expect(rows.map((r) => [r.name, r.position])).toEqual([
      [`${marker} Next up`, 0],
      [a.name, 1],
    ])
    expect(rows[0]).toMatchObject({ icon: '🚀', color: '#ef4444' })

    // The portal follows: two columns in the new order, gamma's post gone from
    // this roadmap but still in its status.
    await page.goto(`/roadmap?roadmap=${roadmap.id}`)
    const titles = page.locator('[data-slot="card-title"]')
    await expect(titles).toHaveText([`🚀${marker} Next up`, a.name])
    await expect(roadmapCard(page, inC.title)).toHaveCount(0)
    const [post] =
      await supportDb()`SELECT status_id FROM posts WHERE id = ${toUuid(inC.id as `post_${string}`)}`
    expect(String(post.status_id)).toBe(toUuid(c.id as `post_status_${string}`))
  }
)

test(
  'RMP-A-15 deleting a roadmap: the confirm copy, a soft delete, posts untouched, gone from the portal',
  { tag: '@core' },
  async ({ asPerson, page, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const board = await rm.board(marker)
    const post = await rm.post({ boardId: board.id, title: `${marker} idea`, statusId: status.id })
    const roadmap = await rm.roadmap({
      name: `${marker} doomed`,
      visibility: 'public',
      columns: [column(status)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)

    // Cancel first: nothing changes.
    await rowMenu(admin, roadmap.name, 'Delete')
    const confirm = admin.getByRole('alertdialog', { name: 'Delete roadmap?' })
    await expect(confirm).toContainText(
      `Are you sure you want to delete "${roadmap.name}"? Posts are not changed because roadmap placement is derived from their fields.`
    )
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    expect((await roadmapRow(roadmap.id)).deleted_at).toBeNull()

    await rowMenu(admin, roadmap.name, 'Delete')
    await confirm.getByRole('button', { name: 'Delete roadmap' }).click()
    await expect(confirm).toBeHidden()
    await expect(sidebarRow(admin, roadmap.name)).toHaveCount(0)

    expect((await roadmapRow(roadmap.id)).deleted_at).not.toBeNull()
    const [p] =
      await supportDb()`SELECT status_id, deleted_at FROM posts WHERE id = ${toUuid(post.id as `post_${string}`)}`
    expect(p.deleted_at).toBeNull()
    expect(String(p.status_id)).toBe(toUuid(status.id as `post_status_${string}`))

    const api = await personApi(playwright, 'admin')
    for (const [fn, data] of [
      ['fetchRoadmap', { id: roadmap.id }],
      ['updateRoadmapFn', { id: roadmap.id, name: `${marker} revived` }],
      ['deleteRoadmapFn', { id: roadmap.id }],
    ] as const) {
      const res = await callServerFn(api, fn, data, {
        method: fn === 'fetchRoadmap' ? 'GET' : 'POST',
      })
      expect(res.code, fn).toBe('ROADMAP_NOT_FOUND')
    }
    await api.dispose()

    await page.goto('/roadmap')
    await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: roadmap.name })).toHaveCount(0)
  }
)

test(
  'RMP-A-18 a Contributor (no roadmap.manage) sees no roadmap on the board and every read is refused',
  { tag: '@core' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const roadmap = await rm.roadmap({
      name: `${marker} secret`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()

    const contributor = await asPerson('contributor')
    await contributor.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await expect(contributor.getByText(roadmap.name)).toHaveCount(0)

    const api = await personApi(playwright, 'contributor')
    const list = await callServerFn(api, 'fetchRoadmaps', undefined, { method: 'GET' })
    expect(list.ok).toBe(false)
    expect(list.error).toContain('roadmap.manage')
    const posts = await callServerFn(
      api,
      'getRoadmapPostsFn',
      { roadmapId: roadmap.id, statusId: status.id },
      { method: 'GET' }
    )
    expect(posts.ok).toBe(false)
    await api.dispose()
  }
)

test(
  'RMP-A-21 every admin roadmap server function refuses callers without roadmap.manage and changes nothing',
  { tag: '@core' },
  async ({ playwright, people, marker, browser }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const roadmap = await rm.roadmap({
      name: `${marker} guarded`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()
    const colId = roadmap.columns[0].id

    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const portal = await portalContext(browser, customer)
    const contributor = await personApi(playwright, 'contributor')

    const calls: Array<[string, unknown, 'GET' | 'POST']> = [
      ['fetchRoadmaps', undefined, 'GET'],
      ['fetchRoadmap', { id: roadmap.id }, 'GET'],
      ['createRoadmapFn', { name: `${marker} new`, slug: slugOf(`${marker} new`) }, 'POST'],
      ['updateRoadmapFn', { id: roadmap.id, name: `${marker} renamed` }, 'POST'],
      ['deleteRoadmapFn', { id: roadmap.id }, 'POST'],
      [
        'createRoadmapColumnFn',
        { roadmapId: roadmap.id, statusId: status.id, name: 'x', color: '#000000' },
        'POST',
      ],
      ['updateRoadmapColumnFn', { id: colId, name: `${marker} col` }, 'POST'],
      ['deleteRoadmapColumnFn', { id: colId }, 'POST'],
      ['reorderRoadmapsFn', { roadmapIds: [roadmap.id] }, 'POST'],
      ['getRoadmapPostsFn', { roadmapId: roadmap.id, statusId: status.id }, 'GET'],
      ['getRoadmapColumnsFn', { roadmapId: roadmap.id, columns: [{ statusId: status.id }] }, 'GET'],
    ]
    const signedOut = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    for (const [who, api] of [
      ['contributor', contributor],
      ['portal user', portal.request],
      ['signed out', signedOut],
    ] as const) {
      for (const [fn, data, method] of calls) {
        const res = await callServerFn(api, fn, data, { method })
        expect(res.ok, `${who} ${fn}`).toBe(false)
      }
    }
    await contributor.dispose()
    await signedOut.dispose()
    await portal.close()

    const row = await roadmapRow(roadmap.id)
    expect(row).toMatchObject({ name: roadmap.name, deleted_at: null })
    expect(await columnStatuses(roadmap.id)).toEqual([toUuid(status.id as `post_status_${string}`)])
    const [{ n }] =
      await supportDb()`SELECT count(*)::int AS n FROM roadmaps WHERE slug = ${slugOf(`${marker} new`)}`
    expect(n).toBe(0)
    const [{ c }] =
      await supportDb()`SELECT count(*)::int AS c FROM roadmap_columns WHERE name = ${`${marker} col`}`
    expect(c).toBe(0)
  }
)

test(
  'RMP-A-02 selecting a roadmap writes ?roadmap=, survives a reload, and a stale id shows "No roadmap selected"',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const one = await rm.roadmap({
      name: `${marker} one`,
      visibility: 'team',
      columns: [column(status)],
    })
    const two = await rm.roadmap({
      name: `${marker} two`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${one.id}`)
    await expect(admin.getByRole('heading', { name: one.name })).toBeVisible()
    const row = sidebarRow(admin, two.name)
    await waitForHydration(row)
    await row.click()
    await expect(admin).toHaveURL(new RegExp(`[?&]roadmap=${two.id}`))
    await expect(admin.getByRole('heading', { name: two.name })).toBeVisible()
    await expect(sidebarRow(admin, two.name)).toHaveAttribute('data-active', 'true')
    await expect(sidebarRow(admin, one.name)).not.toHaveAttribute('data-active', 'true')
    await admin.reload()
    await expect(admin.getByRole('heading', { name: two.name })).toBeVisible()

    await admin.goto('/admin/roadmap?roadmap=roadmap_00000000000000000000000000')
    await expect(admin.getByText('No roadmap selected')).toBeVisible()
    await expect(sidebarRow(admin, one.name)).toBeVisible()
  }
)

test(
  'RMP-A-10 switching to date periods drops the columns; switching back starts with none ticked',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${roadmap.id}`)
    await rowMenu(admin, roadmap.name, 'Edit')
    const dialog = admin.getByRole('dialog', { name: 'Edit roadmap' })
    await dialog.getByLabel('Layout', { exact: true }).selectOption('date')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await roadmapRow(roadmap.id)).type).toBe('date')
    expect(await roadmapRow(roadmap.id)).toMatchObject({ date_source: 'eta', frequency: 'monthly' })
    expect(await columnStatuses(roadmap.id)).toEqual([])
    await expect(adminColumn(admin, 'No ETA')).toBeVisible()

    await rowMenu(admin, roadmap.name, 'Edit')
    await dialog.getByLabel('Layout', { exact: true }).selectOption('column')
    await expect(dialog.getByText('Each status can appear once.', { exact: false })).toBeVisible()
    await expect(dialog.getByLabel(`${status.name} column name`)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  }
)

test(
  'RMP-A-14 the builder needs a segment for segment visibility; a team-only roadmap gets a lock',
  { tag: '@nightly' },
  async ({ asPerson, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/roadmap')
    const dialog = await openCreate(admin)
    const name = `${marker} private plan`
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Visibility', { exact: true }).selectOption('segment')
    await expect(dialog.getByText('Select at least one segment.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create roadmap' })).toBeDisabled()

    await dialog.getByLabel('Visibility', { exact: true }).selectOption('team')
    await expect(dialog.getByText('Select at least one segment.')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Create roadmap' }).click()
    await expect(dialog).toBeHidden()
    const id = new URL(admin.url()).searchParams.get('roadmap')!
    trackRoadmap(id)
    expect((await roadmapRow(id)).visibility).toBe('team')
    // Map icon, lock, kebab.
    await expect(sidebarRow(admin, name).locator('svg')).toHaveCount(3)
  }
)

test(
  'RMP-A-16 deleting the selected first roadmap moves the board to another roadmap',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'roadmap-sidebar.tsx handleDelete re-selects roadmaps[0] from the list captured before the delete, which is the deleted roadmap (see QUARANTINE.md)',
    },
  },
  async ({ asPerson, playwright, people, marker }) => {
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const first = await rm.roadmap({
      name: `${marker} first`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()
    // Put it first in the list.
    await supportDb()`UPDATE roadmaps SET position = -1000 WHERE id = ${toUuid(first.id as `roadmap_${string}`)}`

    const admin = await asPerson('admin')
    await admin.goto(`/admin/roadmap?roadmap=${first.id}`)
    await expect(admin.getByRole('heading', { name: first.name })).toBeVisible()
    await rowMenu(admin, first.name, 'Delete')
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete roadmap' }).click()
    await expect(sidebarRow(admin, first.name)).toHaveCount(0)
    await expect(admin.getByText('No roadmap selected')).toHaveCount(0)
    await expect(admin.locator('main h1, main h2').first()).not.toHaveText(first.name)
  }
)

test(
  'RMP-A-20 admin board filters: search, board, tag, author segment and sort narrow every column',
  { tag: '@nightly' },
  async ({ asPerson, playwright, people, marker }) => {
    const author = await mintCustomer({ email: `${marker}@customers.example` })
    const segment = await segmentWith(marker, [author.principalUuid])
    const rm = await roadmapApi(playwright, people)
    const status = await rm.status(marker)
    const boardA = await rm.board(marker, { name: `${marker} board a` })
    const boardB = await rm.board(marker, { name: `${marker} board b` })
    const tagRes = await rm.rest.post('/api/v1/tags', {
      data: { name: `${marker.slice(-20)} tag`, color: '#22c55e' },
    })
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
    // Authored by the segment member (seeded: the key's own principal posts).
    await supportDb()`UPDATE posts SET principal_id = ${author.principalUuid}
      WHERE id = ${toUuid(cherry.id as `post_${string}`)}`
    const roadmap = await rm.roadmap({
      name: `${marker} map`,
      visibility: 'team',
      columns: [column(status)],
    })
    await rm.dispose()
    const titles = [apple.title, banana.title, `${marker} cherry`]

    const admin = await asPerson('admin')
    const base = `/admin/roadmap?roadmap=${roadmap.id}`
    // Array search params are JSON in the URL, as the filter bar writes them.
    const list = (id: string) => encodeURIComponent(JSON.stringify([id]))
    const shown = async () => {
      const col = adminColumn(admin, status.name)
      await expect(col.locator('[aria-roledescription="draggable"]').first()).toBeVisible()
      return col.locator('[aria-roledescription="draggable"] p').allTextContents()
    }
    await admin.goto(base)
    await expect.poll(shown).toEqual(expect.arrayContaining(titles))

    const search = admin.getByPlaceholder(/^Search posts/)
    await waitForHydration(search)
    await search.fill(`${marker} banana`)
    await expect(admin).toHaveURL(/[?&]search=/)
    await expect.poll(shown).toEqual([banana.title])

    await admin.goto(`${base}&board=${list(boardA.id)}`)
    await expect
      .poll(async () => (await shown()).sort())
      .toEqual([apple.title, `${marker} cherry`].sort())
    await admin.goto(`${base}&tags=${list(tag.id)}`)
    await expect.poll(shown).toEqual([banana.title])
    await admin.goto(`${base}&segments=${list(segment)}`)
    await expect.poll(shown).toEqual([`${marker} cherry`])

    // Newest first, then oldest first.
    await admin.goto(`${base}&sort=newest`)
    await expect.poll(shown).toEqual([`${marker} cherry`, banana.title, apple.title])
    await admin.goto(`${base}&sort=oldest`)
    await expect.poll(shown).toEqual([apple.title, banana.title, `${marker} cherry`])
  }
)
