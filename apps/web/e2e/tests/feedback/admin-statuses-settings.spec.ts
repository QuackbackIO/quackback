/**
 * Settings > Statuses: the category cards, create, edit, roadmap switch,
 * reorder, delete and the default status.
 *
 * Every test makes its own marker-named statuses and deletes them after, so
 * the seed's statuses keep their names, order and default.
 *
 * Journeys: FBA-T-20 FBA-T-21 FBA-T-22 FBA-T-23 FBA-T-24 FBA-T-25
 * Skipped: FBA-T-26 (see the test)
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import { ISOLATED } from '../../support/automation'
import { makeBoard, makePost, statusIdBySlug, uuid } from '../../product/feedback-admin'
import { eventTypesFor, statusRowByName } from '../../product/feedback-admin-settings'

interface MadeStatus {
  id: string
  name: string
  slug: string
}

/** Statuses a test made, deleted (soft) when it ends. */
const made: string[] = []

async function makeStatus(
  api: APIRequestContext,
  name: string,
  category: 'active' | 'complete' | 'closed' = 'active'
): Promise<MadeStatus> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  // The New status dialog sends the next position in the category; so do we.
  const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM post_statuses
                                     WHERE category = ${category} AND deleted_at IS NULL`
  const res = await callServerFn<MadeStatus>(api, 'createStatusFn', {
    name,
    slug,
    color: '#3b82f6',
    category,
    position: n,
  })
  if (!res.ok) throw new Error(`createStatusFn failed: ${res.raw.slice(0, 300)}`)
  made.push(res.data.id)
  return res.data
}

/** Open a row's actions menu and pick an item (the list re-renders while other tests add statuses). */
async function rowMenu(page: Page, rowName: string, item: string): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: `Actions for ${rowName}` }).click()
    await page.getByRole('menuitem', { name: item }).click({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
}

/** A status name that fits the 50-character limit and is unique to the test. */
function statusName(marker: string, label: string): string {
  return `${label} ${marker.slice(-14)}`
}

test.afterEach(async () => {
  // Soft-delete what the test made (posts using them are moved to `open`).
  const sql = supportDb()
  for (const id of made.splice(0)) {
    const [open] =
      await sql`SELECT id FROM post_statuses WHERE slug = 'open' AND deleted_at IS NULL`
    await sql`UPDATE posts SET status_id = ${open.id} WHERE status_id = ${uuid(id)}`
    await sql`UPDATE post_statuses SET deleted_at = now() WHERE id = ${uuid(id)} AND deleted_at IS NULL`
  }
})

test(
  'FBA-T-20 the statuses page groups statuses by category and locks the default',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const mine = await makeStatus(api, statusName(marker, 'Triage'))
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/statuses')
    await waitForHydration(admin.getByRole('button', { name: 'Actions for Open' }))
    for (const [title, sub] of [
      ['Active', 'In progress'],
      ['Complete', 'Done, shown as completed'],
      ['Closed', "Won't be done"],
    ]) {
      await expect(admin.getByText(title, { exact: true }).first()).toBeVisible()
      await expect(admin.getByText(sub, { exact: true })).toBeVisible()
    }

    // The default (Open) carries the lock and offers Edit but no Delete.
    const lock = admin.getByRole('button', { name: 'Reorder Open' }).locator('xpath=../..')
    await expect(lock.getByLabel('Locked')).toBeVisible()
    await lock.getByLabel('Locked').hover()
    await expect(
      admin.getByText('Default status for new posts. It cannot be removed.').first()
    ).toBeVisible()
    await expect(async () => {
      await admin.keyboard.press('Escape')
      await admin.getByRole('button', { name: 'Actions for Open' }).click()
      await expect(admin.getByRole('menuitem', { name: 'Edit' })).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await expect(admin.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
    await admin.keyboard.press('Escape')

    // A status of our own has both, plus a drag handle and a roadmap switch.
    await expect(admin.getByRole('button', { name: `Reorder ${mine.name}` })).toBeVisible()
    await expect(
      admin.getByRole('switch', { name: `Show ${mine.name} on the roadmap` })
    ).toBeVisible()
    await expect(async () => {
      await admin.keyboard.press('Escape')
      await admin.getByRole('button', { name: `Actions for ${mine.name}` }).click()
      await expect(admin.getByRole('menuitem', { name: 'Delete' })).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
  }
)

test(
  'FBA-T-21 New status derives the slug, lands at the end of its category and refuses a duplicate',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const name = statusName(marker, 'In Review')
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const [{ n: activeBefore }] = await supportDb()`
      SELECT count(*)::int AS n FROM post_statuses WHERE category = 'active' AND deleted_at IS NULL`

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/statuses')
    await waitForHydration(admin.getByRole('button', { name: 'Actions for Open' }))
    const dialog = admin.getByRole('dialog')
    await expect(async () => {
      await admin.getByRole('button', { name: 'New status' }).click()
      await expect(dialog.getByLabel('Name')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await dialog.getByLabel('Name').fill(name)
    await expect(dialog.getByLabel('Slug (for API)')).toHaveValue(slug)
    await dialog.getByRole('button', { name: 'Create status' }).click()
    await expect(dialog).toBeHidden()

    const row = await statusRowByName(name)
    expect(row).toBeDefined()
    made.push(fromUuid('post_status', String(row!.id)))
    expect(row!.slug).toBe(slug)
    expect(row!.category).toBe('active')
    expect(row!.show_on_roadmap).toBe(false)
    expect(row!.is_default).toBe(false)
    // It lands after every status the category had when the dialog opened.
    expect(Number(row!.position)).toBeGreaterThanOrEqual(activeBefore)
    await expect(admin.getByRole('button', { name: `Reorder ${name}` })).toBeVisible()

    // The same name again is refused.
    await admin.getByRole('button', { name: 'New status' }).click()
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Create status' }).click()
    await expect(admin.getByText(`A status with slug '${slug}' already exists`)).toBeVisible()
    const [{ n }] =
      await supportDb()`SELECT count(*)::int AS n FROM post_statuses WHERE slug = ${slug}`
    expect(n).toBe(1)
  }
)

test(
  'FBA-T-21 a status can be created again with the slug of a deleted one',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-T-21: createStatus checks the slug against soft-deleted statuses too (status.service.ts:72), so a deleted status blocks its slug for ever',
    },
  },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const name = statusName(marker, 'Reborn')
    const first = await makeStatus(api, name)
    const del = await callServerFn(api, 'deleteStatusFn', { id: first.id })
    expect(del.ok, del.raw).toBe(true)
    const again = await callServerFn<MadeStatus>(api, 'createStatusFn', {
      name,
      slug: first.slug,
      color: '#3b82f6',
      category: 'active',
    })
    if (again.ok) made.push(again.data.id)
    expect(again.code).not.toBe('DUPLICATE_SLUG')
    expect(again.ok, again.raw).toBe(true)
    await api.dispose()
  }
)

test(
  'FBA-T-22 renaming and recolouring a status persist and the next status event names it',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const status = await makeStatus(api, statusName(marker, 'Draft'))
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} idea` })

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/statuses')
    await waitForHydration(admin.getByRole('button', { name: 'Actions for Open' }))
    await rowMenu(admin, status.name, 'Edit')
    const dialog = admin.getByRole('dialog')
    await expect(dialog.getByText('Edit status')).toBeVisible()
    const renamed = statusName(marker, 'Shaping')
    await dialog.getByLabel('Name').fill(renamed)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(
        async () =>
          (await supportDb()`SELECT name FROM post_statuses WHERE id = ${uuid(status.id)}`)[0].name
      )
      .toBe(renamed)

    // The colour dot autosaves.
    await admin.getByRole('button', { name: `Change colour of ${renamed}` }).click()
    const hex = admin.getByRole('textbox').last()
    await hex.fill('#123456')
    await hex.press('Enter')
    await expect
      .poll(
        async () =>
          (await supportDb()`SELECT color FROM post_statuses WHERE id = ${uuid(status.id)}`)[0]
            .color
      )
      .toBe('#123456')
    const [row] = await supportDb()`SELECT slug FROM post_statuses WHERE id = ${uuid(status.id)}`
    expect(row.slug).toBe(status.slug)

    // The next status change names the status as it is called now.
    const res = await callServerFn(api, 'changePostStatusFn', { id: post.id, statusId: status.id })
    expect(res.ok, res.raw).toBe(true)
    await expect
      .poll(async () => (await eventTypesFor(post.id)).includes('post.status_changed'))
      .toBe(true)
    const [event] = await supportDb()`SELECT payload FROM events
      WHERE type = 'post.status_changed' AND payload::text LIKE ${'%' + post.id + '%'}`
    expect(JSON.stringify(event.payload)).toContain(renamed)
    await api.dispose()
  }
)

test(
  'FBA-T-23 the Roadmap switch and a keyboard drag save show_on_roadmap and the order',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const first = await makeStatus(api, statusName(marker, 'Shelved'), 'closed')
    const second = await makeStatus(api, statusName(marker, 'Declined'), 'closed')
    await api.dispose()
    const pos = async (id: string) =>
      Number(
        (await supportDb()`SELECT position FROM post_statuses WHERE id = ${uuid(id)}`)[0].position
      )
    expect(await pos(second.id)).toBeGreaterThan(await pos(first.id))

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/statuses')
    await waitForHydration(admin.getByRole('button', { name: 'Actions for Open' }))
    // The first click can land before hydration; click until it shows on.
    const roadmap = admin.getByRole('switch', { name: `Show ${first.name} on the roadmap` })
    await expect(async () => {
      if ((await roadmap.getAttribute('aria-checked')) !== 'true') await roadmap.click()
      await expect(roadmap).toHaveAttribute('aria-checked', 'true', { timeout: 1500 })
    }).toPass({ timeout: 15_000 })
    await expect
      .poll(
        async () =>
          (
            await supportDb()`SELECT show_on_roadmap FROM post_statuses WHERE id = ${uuid(first.id)}`
          )[0].show_on_roadmap
      )
      .toBe(true)

    // Move the second above the first with the keyboard sensor.
    const grip = admin.getByRole('button', { name: `Reorder ${second.name}` })
    await grip.focus()
    // dnd-kit's keyboard sensor measures between steps; give it a beat.
    for (const key of ['Space', 'ArrowUp', 'Space']) {
      await admin.keyboard.press(key)
      await admin.waitForTimeout(300)
    }
    await expect.poll(async () => (await pos(second.id)) < (await pos(first.id))).toBe(true)
    await admin.reload()
    const names = await admin
      .getByRole('button', { name: /^Reorder / })
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names.indexOf(`Reorder ${second.name}`)).toBeLessThan(
      names.indexOf(`Reorder ${first.name}`)
    )
  }
)

test(
  'FBA-T-24 deleting a status asks first and is refused for the default and for a status in use',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const unused = await makeStatus(api, statusName(marker, 'Unused'))
    const used = await makeStatus(api, statusName(marker, 'Used'))
    const board = await makeBoard(api, marker)
    await makePost(api, { boardId: board.id, title: `${marker} idea`, statusId: used.id })

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/statuses')
    await waitForHydration(admin.getByRole('button', { name: 'Actions for Open' }))
    await rowMenu(admin, unused.name, 'Delete')
    const confirm = admin.getByRole('alertdialog').or(admin.getByRole('dialog'))
    await expect(confirm.getByText('Delete status?')).toBeVisible()
    await expect(
      confirm.getByText(`"${unused.name}" will be removed. This cannot be undone.`)
    ).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete status' }).click()
    await expect(admin.getByRole('button', { name: `Reorder ${unused.name}` })).toHaveCount(0)
    await expect
      .poll(async () => {
        const [row] =
          await supportDb()`SELECT deleted_at FROM post_statuses WHERE id = ${uuid(unused.id)}`
        return row.deleted_at !== null
      })
      .toBe(true)

    // In use: refused with the count, shown in the toast.
    await rowMenu(admin, used.name, 'Delete')
    await confirm.getByRole('button', { name: 'Delete status' }).click()
    await expect(
      admin.getByText('Cannot delete status. 1 post(s) are using this status. Reassign them first.')
    ).toBeVisible()
    const inUse = await callServerFn(api, 'deleteStatusFn', { id: used.id })
    expect(inUse.code).toBe('CANNOT_DELETE_IN_USE')

    // The default: the menu has no Delete, and the server refuses too.
    const def = await callServerFn(api, 'deleteStatusFn', { id: await statusIdBySlug('open') })
    expect(def.ok).toBe(false)
    expect(def.code).toBe('CANNOT_DELETE_DEFAULT')
    await api.dispose()
  }
)

test(
  'FBA-T-25 marking another status default leaves exactly one default',
  {
    tag: ['@nightly', '@isolated', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-T-25: updateStatus with only { isDefault: true } moves the default, then runs an UPDATE with an empty SET (status.service.ts:136-149), which drizzle refuses ("No values to set"), so the call answers 500',
    },
  },
  async ({ playwright, marker }) => {
    test.skip(!ISOLATED, 'moves the workspace default status: runs in product-isolated')
    const api = await personApi(playwright, 'admin')
    const openId = await statusIdBySlug('open')
    const status = await makeStatus(api, statusName(marker, 'Fresh'))
    try {
      const res = await callServerFn(api, 'updateStatusFn', { id: status.id, isDefault: true })
      expect(res.ok, res.raw).toBe(true)
      const defaults = await supportDb()`SELECT id FROM post_statuses
                                          WHERE is_default AND deleted_at IS NULL`
      expect(defaults.map((r) => String(r.id))).toEqual([uuid(status.id)])
    } finally {
      await supportDb()`UPDATE post_statuses SET is_default = (id = ${uuid(openId)})
                        WHERE deleted_at IS NULL`
      await api.dispose()
    }
  }
)

test(
  'FBA-T-25 the only default status cannot be unset',
  {
    tag: ['@nightly', '@isolated', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-T-25: updateStatus { isDefault: false } on the default clears it (status.service.ts:136), leaving the workspace with no default status',
    },
  },
  async ({ playwright }) => {
    test.skip(!ISOLATED, 'can clear the workspace default status: runs in product-isolated')
    const api = await personApi(playwright, 'admin')
    const openId = await statusIdBySlug('open')
    try {
      const res = await callServerFn(api, 'updateStatusFn', { id: openId, isDefault: false })
      const defaults = await supportDb()`SELECT id FROM post_statuses
                                          WHERE is_default AND deleted_at IS NULL`
      expect(res.ok).toBe(false)
      expect(defaults).toHaveLength(1)
    } finally {
      await supportDb()`UPDATE post_statuses SET is_default = (id = ${uuid(openId)})
                        WHERE deleted_at IS NULL`
      await api.dispose()
    }
  }
)

test(
  'FBA-T-26 a role with status.manage but not status.view cannot open the statuses page',
  { tag: '@nightly' },
  async () => {
    test.skip(true, 'the manage + view gate lands with #1145, which is not merged into this base')
  }
)
