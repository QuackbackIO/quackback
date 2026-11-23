/**
 * Writing the changelog in the admin: the list, the create dialog and the
 * edit modal (status, labels, linked posts, notify options), delete, and who
 * may open the page.
 *
 * Journeys: CHG-A-01, CHG-A-02, CHG-A-04, CHG-A-12, CHG-A-13, CHG-A-14,
 * CHG-A-16, CHG-A-18, CHG-A-21, CHG-A-24, CHG-A-28, CHG-A-29,
 * CHG-A-36, CHG-A-39, CHG-A-41, CHG-A-42.
 *
 * Entries carry the test's marker in their titles and are soft-deleted
 * afterwards; announcements are checked only on the test's own subscribers.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { waitForMail } from '../../support/mailpit'
import { callServerFn, personApi } from '../../support/server-fns'
import { sink } from '../../support/webhook-sink-client'
import { hooksApi, subscribe as hook, unsubscribe } from '../../support/webhooks'
import { createTeammate } from '../../support/teammates'
import { waitForHydration } from '../../utils/helpers'
import {
  adminRest,
  announcementEvents,
  announcementsTo,
  changelogSubscriber,
  createEntry,
  createLabel,
  entryRow,
  retireChangelog,
  segmentWith,
  shippedPost,
  trackEntry,
  updateEntry,
  waitForAnnouncementHandled,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

async function openCreate(page: Page): Promise<Locator> {
  await page.goto('/admin/changelog')
  const dialog = page.getByRole('dialog', { name: 'Create changelog entry' })
  const button = page.getByRole('button', { name: /new entry/i })
  await waitForHydration(button)
  // The dialog is a lazy chunk (editor included), so under load it can take
  // seconds to appear after the click. Click again only while it is still
  // missing, and never wait unbounded: a click behind an open modal never
  // lands (the page under it takes no pointer events).
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click({ timeout: 2_000 })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 20_000 })
  return dialog
}

async function fill(dialog: Locator, title: string, body: string): Promise<void> {
  await dialog.getByPlaceholder("What's new?").fill(title)
  await dialog.locator('[contenteditable="true"]').fill(body)
}

async function setStatus(page: Page, scope: Locator, from: string, to: string): Promise<void> {
  await scope
    .locator('[data-slot="popover-trigger"]')
    .filter({ hasText: new RegExp(`^${from}$`) })
    .click()
  await page.getByRole('button', { name: to, exact: true }).last().click()
  await expect(
    scope.locator('[data-slot="popover-trigger"]').filter({ hasText: new RegExp(`^${to}$`) })
  ).toBeVisible()
}

/** The "Send email to subscribers" checkbox (it has no label of its own). */
function notifyBox(dialog: Locator): Locator {
  return dialog
    .locator('div:has(> span:text-is("Send email to subscribers"))')
    .getByRole('checkbox')
}

/** The entry created through the UI, by its unique title. */
async function entryByTitle(title: string): Promise<{ id: string; row: Record<string, unknown> }> {
  let row: Record<string, unknown> | undefined
  await expect
    .poll(async () => {
      ;[row] = await supportDb()`SELECT * FROM changelog_entries WHERE title = ${title}`
      return !!row
    })
    .toBe(true)
  const id = fromUuid('changelog', row!.id as string)
  trackEntry(id)
  return { id, row: row! }
}

/** An admin list row, by entry title. */
function listRow(page: Page, title: string): Locator {
  return page.locator('div.group').filter({ hasText: title })
}

async function publicIds(api: APIRequestContext): Promise<string[]> {
  const res = await callServerFn<{ items: Array<{ id: string }> }>(
    api,
    'listPublicChangelogsFn',
    { limit: 50 },
    { method: 'GET' }
  )
  return res.data.items.map((i) => i.id)
}

test(
  'CHG-A-04 "Publish now" makes an entry public at once and announces it once',
  { tag: '@smoke' },
  async ({ asPerson, page, marker }) => {
    const sub = await changelogSubscriber(marker)
    const admin = await asPerson('admin')
    const dialog = await openCreate(admin)
    const title = `${marker} launched`
    await fill(dialog, title, `${marker} the launch notes`)
    await setStatus(admin, dialog, 'Draft', 'Published')
    await expect(dialog.getByText('Send email to subscribers')).toBeVisible()
    await dialog.getByRole('button', { name: 'Publish now', exact: true }).click()
    await expect(dialog).toBeHidden()
    const { id, row } = await entryByTitle(title)
    expect(row.published_at).not.toBeNull()

    await expect(listRow(admin, title).getByText('Published', { exact: true })).toBeVisible()
    await page.goto(`/changelog/${id}`)
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
    await expect(page.getByText(`${marker} the launch notes`)).toBeVisible()
    await waitForMail({ to: sub.email, subject: `New update: ${title}` })
    await waitForAnnouncementHandled(id)
    expect(await announcementsTo(sub.email, title)).toHaveLength(1)
  }
)

test(
  'CHG-A-14 unpublishing takes an entry off every public surface without any event',
  { tag: '@smoke' },
  async ({ asPerson, page, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, {
      title: `${marker} withdraw me`,
      state: 'published',
      notify: false,
    })
    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByRole('heading', { name: entry.title, level: 1 })).toBeVisible()

    const admin = await asPerson('admin')
    await admin.goto(`/admin/changelog?entry=${entry.id}`)
    const modal = admin.getByRole('dialog').filter({ has: admin.getByPlaceholder("What's new?") })
    await expect(modal.getByPlaceholder("What's new?")).toHaveValue(entry.title)
    await setStatus(admin, modal, 'Published', 'Draft')
    await modal.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect.poll(async () => (await entryRow(entry.id)).published_at).toBeNull()
    expect((await entryRow(entry.id)).notified_at).not.toBeNull()

    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByText('Changelog entry not found')).toBeVisible()
    expect(await publicIds(page.request)).not.toContain(entry.id)
    const feed = await (await page.request.get('/changelog/feed')).text()
    expect(feed).not.toContain(entry.id)
    expect(await announcementEvents(entry.id)).toBe(0)
    await api.dispose()
  }
)

test(
  'CHG-A-01 the admin list: status badges, row lines, status filter and sort in the URL',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const draft = await createEntry(api, { title: `${marker} a draft` })
    const scheduled = await createEntry(api, {
      title: `${marker} b scheduled`,
      state: { type: 'scheduled', publishAt: new Date(Date.now() + 86_400_000).toISOString() },
    })
    const published = await createEntry(api, {
      title: `${marker} c published`,
      state: 'published',
      notify: false,
    })
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/changelog')
    await expect(listRow(admin, draft.title).getByText('Draft', { exact: true })).toBeVisible()
    await expect(listRow(admin, draft.title)).toContainText('Created')
    await expect(
      listRow(admin, scheduled.title).getByText('Scheduled', { exact: true })
    ).toBeVisible()
    await expect(listRow(admin, scheduled.title)).toContainText('Scheduled for')
    await expect(
      listRow(admin, published.title).getByText('Published', { exact: true })
    ).toBeVisible()
    await expect(listRow(admin, published.title)).toContainText(`${published.title} body text.`)

    await admin.goto('/admin/changelog?status=draft')
    await expect(listRow(admin, draft.title)).toBeVisible()
    await expect(listRow(admin, published.title)).toHaveCount(0)
    await admin.goto('/admin/changelog?status=published')
    await expect(listRow(admin, published.title)).toBeVisible()
    await expect(listRow(admin, draft.title)).toHaveCount(0)
    await expect(listRow(admin, scheduled.title)).toHaveCount(0)
    await admin.goto('/admin/changelog?status=scheduled')
    await expect(listRow(admin, scheduled.title)).toBeVisible()
    await expect(listRow(admin, published.title)).toHaveCount(0)

    // ?sort=oldest is written by the sort control and orders by creation.
    await admin.goto('/admin/changelog?sort=oldest')
    const rows = admin.locator('div.group').filter({ hasText: marker })
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText(draft.title)
    await expect(rows.nth(2)).toContainText(published.title)
    await admin.goto('/admin/changelog?sort=newest')
    await expect(rows.nth(0)).toContainText(published.title)
  }
)

test(
  'CHG-A-02 saving a draft: in the list as Draft, nowhere public, no job and no event',
  { tag: '@core' },
  async ({ asPerson, page, marker }) => {
    const admin = await asPerson('admin')
    const dialog = await openCreate(admin)
    const title = `${marker} draft only`
    await fill(dialog, title, `${marker} draft body`)
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    const { id, row } = await entryByTitle(title)
    expect(row).toMatchObject({ published_at: null, notified_at: null, view_count: 0 })
    expect(String(row.content)).toContain(`${marker} draft body`)
    expect(row.content_json).not.toBeNull()
    await expect(listRow(admin, title).getByText('Draft', { exact: true })).toBeVisible()
    const [job] =
      await supportDb()`SELECT 1 FROM job_queue WHERE dedupe_key = ${`changelog-publish--${id}`}`
    expect(job).toBeUndefined()
    expect(await announcementEvents(id)).toBe(0)
    await page.goto(`/changelog/${id}`)
    await expect(page.getByText('Changelog entry not found')).toBeVisible()
  }
)

test(
  'CHG-A-12 editing a draft saves the new title and body and closes the editor',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, { title: `${marker} before` })
    await api.dispose()
    const admin = await asPerson('admin')
    await admin.goto('/admin/changelog')
    const heading = listRow(admin, entry.title).getByRole('heading', { name: entry.title })
    await waitForHydration(heading)
    await heading.click()
    await expect(admin).toHaveURL(new RegExp(`[?&]entry=${entry.id}`))
    const modal = admin.getByRole('dialog').filter({ has: admin.getByPlaceholder("What's new?") })
    const title = `${marker} after`
    await modal.getByPlaceholder("What's new?").fill(title)
    await modal.locator('[contenteditable="true"]').fill(`${marker} new body`)
    await modal.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect(admin).not.toHaveURL(/[?&]entry=/)
    await expect(listRow(admin, title)).toBeVisible()
    const saved = await entryRow(entry.id)
    expect(saved).toMatchObject({ title, published_at: null })
    expect(String(saved.content)).toContain(`${marker} new body`)
  }
)

test(
  'CHG-A-13 editing a published entry goes live, keeps its publish date and does not re-announce',
  { tag: '@core' },
  async ({ asPerson, page, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(api, { title: `${marker} live`, state: 'published' })
    await waitForMail({ to: sub.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    const before = (await entryRow(entry.id)).published_at as Date

    const admin = await asPerson('admin')
    await admin.goto(`/admin/changelog?entry=${entry.id}`)
    const modal = admin.getByRole('dialog').filter({ has: admin.getByPlaceholder("What's new?") })
    await expect(modal.getByPlaceholder("What's new?")).toHaveValue(entry.title)
    await modal.locator('[contenteditable="true"]').fill(`${marker} corrected notes`)
    await modal.getByRole('button', { name: 'Update and publish', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect
      .poll(async () => String((await entryRow(entry.id)).content))
      .toContain('corrected notes')
    expect(((await entryRow(entry.id)).published_at as Date).getTime()).toBe(before.getTime())

    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByText(`${marker} corrected notes`)).toBeVisible()
    expect(await announcementEvents(entry.id)).toBe(1)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(1)
    await api.dispose()
  }
)

test(
  'CHG-A-16 deleting an entry: confirm copy that matches a soft delete, then gone from admin and portal',
  { tag: '@core' },
  async ({ asPerson, page, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, {
      title: `${marker} doomed`,
      state: 'published',
      notify: false,
    })
    await api.dispose()
    const admin = await asPerson('admin')
    await admin.goto('/admin/changelog')
    const row = listRow(admin, entry.title)
    await row.hover()
    await row.getByRole('button').last().click()
    await admin.getByRole('menuitem', { name: 'Delete' }).click()
    const confirm = admin.getByRole('alertdialog', { name: 'Delete changelog entry?' })
    await expect(confirm).toBeVisible()
    await expect(confirm).not.toContainText('permanently deleted')
    await confirm.getByRole('button', { name: /delete/i }).click()
    await expect(row).toHaveCount(0)
    expect((await entryRow(entry.id)).deleted_at).not.toBeNull()
    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByText('Changelog entry not found')).toBeVisible()
  }
)

test(
  'CHG-A-18 a display date is what the portal shows; the admin row says "Showing as"',
  { tag: '@core' },
  async ({ asPerson, page, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, {
      title: `${marker} backdated`,
      state: 'published',
      notify: false,
    })
    const shown = new Date(Date.UTC(2025, 5, 3, 12)).toISOString()
    const res = await updateEntry(api, entry.id, {
      displayDate: shown,
      publishState: { type: 'published', publishAt: entry.publishedAt },
    })
    expect(res.ok, res.error).toBe(true)
    await api.dispose()

    await page.goto(`/changelog/${entry.id}`)
    await expect(page.getByText('June 3, 2025').first()).toBeVisible()
    const admin = await asPerson('admin')
    await admin.goto('/admin/changelog')
    await expect(listRow(admin, entry.title)).toContainText('Showing as')
    await expect(listRow(admin, entry.title)).toContainText('Jun 3, 2025')
  }
)

test(
  'CHG-A-21 linking a shipped post from the editor shows it under Shipped Features',
  { tag: '@core' },
  async ({ asPerson, page, playwright, people, marker }) => {
    const rest = await adminRest(playwright, people)
    const post = await shippedPost(rest, marker)
    await rest.dispose()
    const admin = await asPerson('admin')
    const dialog = await openCreate(admin)
    const title = `${marker} with posts`
    await fill(dialog, title, `${marker} body`)
    await dialog.getByRole('button', { name: 'Add', exact: true }).last().click()
    await admin.getByPlaceholder('Search shipped posts…').fill(post.title)
    await admin.getByText(post.title, { exact: true }).click()
    await admin.keyboard.press('Escape')
    await expect(dialog.getByText(post.title).first()).toBeVisible()
    await setStatus(admin, dialog, 'Draft', 'Published')
    await notifyBox(dialog).click()
    await dialog.getByRole('button', { name: 'Publish now', exact: true }).click()
    await expect(dialog).toBeHidden()
    const { id } = await entryByTitle(title)
    const [link] = await supportDb()`SELECT post_id FROM changelog_entry_posts
      WHERE changelog_entry_id = ${toUuid(id as `changelog_${string}`)}`
    expect(fromUuid('post', link.post_id as string)).toBe(post.id)

    await page.goto(`/changelog/${id}`)
    await expect(page.getByText('Shipped Features')).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(post.title) })).toBeVisible()
  }
)

test(
  'CHG-A-24 attaching and removing labels in the editor',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const fix = await createLabel(api, `${marker.slice(-28)} fix`)
    const entry = await createEntry(api, { title: `${marker} labelled`, categoryIds: [fix.id] })
    const neu = await createLabel(api, `${marker.slice(-28)} neu`)
    await api.dispose()
    const admin = await asPerson('admin')
    await admin.goto(`/admin/changelog?entry=${entry.id}`)
    const modal = admin.getByRole('dialog').filter({ has: admin.getByPlaceholder("What's new?") })
    await expect(modal.getByPlaceholder("What's new?")).toHaveValue(entry.title)
    await modal.getByRole('button', { name: `Remove ${fix.name}` }).click()
    await modal.getByRole('button', { name: 'Add', exact: true }).first().click()
    await admin.getByText(neu.name, { exact: true }).click()
    await admin.keyboard.press('Escape')
    await modal.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect
      .poll(async () =>
        (
          await supportDb()`SELECT category_id FROM changelog_entry_categories
            WHERE changelog_entry_id = ${toUuid(entry.id as `changelog_${string}`)}`
        ).map((r) => fromUuid('changelog_category', r.category_id as string))
      )
      .toEqual([neu.id])
  }
)

test(
  'CHG-A-28 the "Send email to subscribers" box shows for published and scheduled, not for drafts',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const admin = await asPerson('admin')
    const dialog = await openCreate(admin)
    await fill(dialog, `${marker} notify box`, 'body')
    await expect(dialog.getByText('Send email to subscribers')).toHaveCount(0)
    await setStatus(admin, dialog, 'Draft', 'Published')
    await expect(dialog.getByText('Send email to subscribers')).toBeVisible()
    await expect(notifyBox(dialog)).toBeChecked()
    await setStatus(admin, dialog, 'Published', 'Scheduled')
    await expect(dialog.getByText('Send email to subscribers')).toBeVisible()
  }
)

test(
  'CHG-A-29 notify segments in the editor narrow the announcement to members',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const member = await changelogSubscriber(marker, 'member')
    const outsider = await changelogSubscriber(marker, 'outsider')
    const segment = await segmentWith(marker, [member.principalUuid])
    const admin = await asPerson('admin')
    const dialog = await openCreate(admin)
    const title = `${marker} for a segment`
    await fill(dialog, title, 'segment body')
    await setStatus(admin, dialog, 'Draft', 'Published')
    await expect(dialog.getByText('Leave empty to notify every subscriber.')).toBeVisible()
    await dialog
      .getByRole('list', { name: 'Changelog notify segments' })
      .getByRole('checkbox', { name: `${marker} segment` })
      .check()
    await dialog.getByRole('button', { name: 'Publish now', exact: true }).click()
    await expect(dialog).toBeHidden()
    const { id, row } = await entryByTitle(title)
    expect(row.segment_ids).toEqual([segment])
    await waitForMail({ to: member.email, subject: title })
    await waitForAnnouncementHandled(id)
    expect(await announcementsTo(outsider.email, title)).toHaveLength(0)
  }
)

test(
  'CHG-A-36 editing, unpublishing and deleting send no webhook and record no event',
  { tag: '@nightly' },
  async ({ playwright, people, marker, baseURL }) => {
    const api = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const wh = await hook(hooks, marker, ['changelog.published'])
    try {
      const entry = await createEntry(api, { title: `${marker} quiet changes`, state: 'published' })
      await sink.waitForDeliveries(marker, { where: (d) => d.body.includes(entry.id) })
      await updateEntry(api, entry.id, { content: `${marker} edited` })
      await updateEntry(api, entry.id, { publishState: { type: 'draft' } })
      await callServerFn(api, 'deleteChangelogFn', { id: entry.id })
      const control = await createEntry(api, { title: `${marker} control`, state: 'published' })
      await sink.waitForDeliveries(marker, { where: (d) => d.body.includes(control.id) })
      await waitForAnnouncementHandled(control.id)
      expect((await sink.deliveries(marker)).filter((d) => d.body.includes(entry.id))).toHaveLength(
        1
      )
      const events =
        await supportDb()`SELECT type FROM events WHERE payload::text LIKE ${`%${entry.id}%`}`
      expect(events.map((e) => e.type)).toEqual(['changelog.published'])
    } finally {
      await unsubscribe(hooks, wh)
      await hooks.dispose()
      await api.dispose()
    }
  }
)

test(
  'CHG-A-39 a teammate without changelog.view_draft cannot read the changelog admin',
  { tag: '@core' },
  async ({ browser, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, { title: `${marker} hidden draft` })
    await api.dispose()
    const mate = await createTeammate({ marker, roleKey: 'e2e_scoped_agent' })
    const page = await mate.newPage(browser)
    await page.goto('/admin/changelog')
    await expect(page.getByText(entry.title)).toHaveCount(0)
    const req = await mate.api(playwright)
    for (const [fn, data] of [
      ['listChangelogsFn', { status: 'all' }],
      ['getChangelogFn', { id: entry.id }],
      ['topViewedChangelogsFn', {}],
    ] as const) {
      const res = await callServerFn(req, fn, data, { method: 'GET' })
      expect(res.ok, fn).toBe(false)
    }
    await req.dispose()
  }
)

test(
  'CHG-A-41 "Most viewed" ranks published entries by their view counts',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, {
      title: `${marker} popular`,
      state: 'published',
      notify: false,
    })
    await supportDb()`UPDATE changelog_entries SET view_count = 2000000000
      WHERE id = ${toUuid(entry.id as `changelog_${string}`)}`
    const res = await callServerFn<Array<{ id: string; viewCount: number }>>(
      api,
      'topViewedChangelogsFn',
      { limit: 5 },
      { method: 'GET' }
    )
    expect(res.ok, res.error).toBe(true)
    expect(res.data[0]).toMatchObject({ id: entry.id, viewCount: 2000000000 })
    // Unpublished, it leaves the card.
    await updateEntry(api, entry.id, { publishState: { type: 'draft' } })
    const after = await callServerFn<Array<{ id: string }>>(
      api,
      'topViewedChangelogsFn',
      { limit: 5 },
      { method: 'GET' }
    )
    expect(after.data.map((e) => e.id)).not.toContain(entry.id)
    await api.dispose()
  }
)

test(
  'CHG-A-42 ?entry= opens the editor on that entry; a deleted id does not',
  { tag: '@nightly' },
  async ({ asPerson, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const entry = await createEntry(api, { title: `${marker} deep link` })
    const gone = await createEntry(api, { title: `${marker} gone` })
    await callServerFn(api, 'deleteChangelogFn', { id: gone.id })
    await api.dispose()
    const admin = await asPerson('admin')
    await admin.goto(`/admin/changelog?entry=${entry.id}`)
    await expect(admin.getByPlaceholder("What's new?")).toHaveValue(entry.title)
    await admin.goto(`/admin/changelog?entry=${gone.id}`)
    await expect(admin.getByPlaceholder("What's new?")).toHaveCount(0)
  }
)
