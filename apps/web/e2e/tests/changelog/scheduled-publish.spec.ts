/**
 * Scheduled changelog entries: visible at their time (read-time), announced
 * once by the delayed `changelog-publish--<id>` job, and the job's fate when
 * the entry is published now, unpublished, rescheduled or deleted.
 *
 * Journeys: CHG-A-05, CHG-A-07, CHG-A-08, CHG-A-09, CHG-A-10, CHG-A-11.
 *
 * Time is never waited for: a test backdates its own entry and its own job
 * row, then runs the `changelog-publish` sweep at the wall clock (which
 * promotes only jobs already due), and the `changelog-notify` reconciler.
 */
import type { APIRequestContext } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { waitForMail } from '../../support/mailpit'
import { callServerFn, personApi } from '../../support/server-fns'
import { runSweep } from '../../support/sweeps'
import { waitForHydration } from '../../utils/helpers'
import {
  announcementEvents,
  announcementsTo,
  changelogSubscriber,
  createEntry,
  entryRow,
  makeJobDue,
  publishJob,
  retireChangelog,
  trackEntry,
  updateEntry,
  waitForAnnouncementHandled,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

/** Move the entry's publish time into the past (as if its time came). */
async function timeComes(entryId: string): Promise<void> {
  await supportDb()`UPDATE changelog_entries SET published_at = now() - interval '1 minute'
    WHERE id = ${toUuid(entryId as `changelog_${string}`)}`
}

/** Run the entry's job if pending, then the reconciler. */
async function runDue(request: APIRequestContext, entryId: string): Promise<void> {
  await makeJobDue(entryId)
  await runSweep(request, 'changelog-publish')
  await runSweep(request, 'changelog-notify')
}

async function publicIds(request: APIRequestContext): Promise<string[]> {
  const res = await request.get('/changelog/feed')
  return [...(await res.text()).matchAll(/\/changelog\/(changelog_[a-z0-9]+)/g)].map((m) => m[1])
}

test(
  'CHG-A-05 scheduling an entry in the editor: Scheduled row, delayed job, nothing public',
  { tag: '@core' },
  async ({ asPerson, request, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/changelog')
    const newEntry = admin.getByRole('button', { name: /new entry/i })
    await waitForHydration(newEntry)
    await newEntry.click()
    const dialog = admin.getByRole('dialog', { name: 'Create changelog entry' })
    const title = `${marker} scheduled`
    await dialog.getByPlaceholder("What's new?").fill(title)
    await dialog.locator('[contenteditable="true"]').fill(`${marker} scheduled body`)
    await dialog.getByRole('button', { name: 'Draft', exact: true }).click()
    await admin.getByRole('button', { name: 'Scheduled', exact: true }).click()
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(dialog).toBeHidden()

    const [row] =
      await supportDb()`SELECT id, published_at FROM changelog_entries WHERE title = ${title}`
    const id = fromUuid('changelog', row.id as string)
    trackEntry(id)
    expect((row.published_at as Date).getTime()).toBeGreaterThan(Date.now())
    const job = await publishJob(id)
    expect(job).not.toBeNull()
    // run_at is now + delay, so it lands within a moment of the publish time.
    expect(
      Math.abs((job.run_at as Date).getTime() - (row.published_at as Date).getTime())
    ).toBeLessThan(2_000)

    const item = admin.getByRole('button', { name: new RegExp(title) }).or(admin.getByText(title))
    await expect(item.first()).toBeVisible()
    await expect(admin.getByText('Scheduled', { exact: true }).first()).toBeVisible()
    await expect(admin.getByText(/Scheduled for/).first()).toBeVisible()
    expect(await publicIds(request)).not.toContain(id)
  }
)

test(
  'CHG-A-07 a scheduled entry goes live at its time and is announced exactly once',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, {
      title: `${marker} at its time`,
      state: { type: 'scheduled', publishAt: hoursFromNow(1) },
    })
    // The delayed job is queued just after the save returns.
    await expect.poll(() => publishJob(entry.id)).not.toBeNull()
    expect(await publicIds(request)).not.toContain(entry.id)

    await timeComes(entry.id)
    // Visibility is read-time: public before any job runs.
    expect(await publicIds(request)).toContain(entry.id)
    await runDue(request, entry.id)
    await waitForMail({ to: sub.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    // A second pass (job and reconciler) announces nothing more.
    await runDue(request, entry.id)
    expect(await announcementEvents(entry.id)).toBe(1)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(1)
    await admin.dispose()
  }
)

test(
  'CHG-A-08 publishing a scheduled entry now cancels its job and announces once',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, {
      title: `${marker} now instead`,
      state: { type: 'scheduled', publishAt: hoursFromNow(2) },
    })
    await expect.poll(() => publishJob(entry.id)).not.toBeNull()
    expect((await updateEntry(admin, entry.id, { publishState: { type: 'published' } })).ok).toBe(
      true
    )
    await expect.poll(() => publishJob(entry.id)).toBeNull()
    const row = await entryRow(entry.id)
    expect((row.published_at as Date).getTime()).toBeLessThanOrEqual(Date.now())
    await waitForMail({ to: sub.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)

    await runDue(request, entry.id)
    expect(await announcementEvents(entry.id)).toBe(1)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(1)
    await admin.dispose()
  }
)

test(
  'CHG-A-09 moving a scheduled entry back to draft cancels its job and sends nothing',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, {
      title: `${marker} back to draft`,
      state: { type: 'scheduled', publishAt: hoursFromNow(1) },
    })
    // The delayed job is queued just after the save returns.
    await expect.poll(() => publishJob(entry.id)).not.toBeNull()
    expect((await updateEntry(admin, entry.id, { publishState: { type: 'draft' } })).ok).toBe(true)
    await expect.poll(() => publishJob(entry.id)).toBeNull()
    await runDue(request, entry.id)

    // Control: another entry is announced, so the queue ran past this point.
    const control = await createEntry(admin, { title: `${marker} control`, state: 'published' })
    await waitForMail({ to: sub.email, subject: control.title })
    await waitForAnnouncementHandled(control.id)
    const row = await entryRow(entry.id)
    expect(row).toMatchObject({ published_at: null, notified_at: null })
    expect(await announcementEvents(entry.id)).toBe(0)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-A-10 rescheduling replaces the delayed job with one at the new time',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} rescheduled`,
      state: { type: 'scheduled', publishAt: hoursFromNow(1) },
    })
    const later = hoursFromNow(2)
    expect(
      (
        await updateEntry(admin, entry.id, {
          publishState: { type: 'scheduled', publishAt: later },
        })
      ).ok
    ).toBe(true)
    // The job now runs at the new time (now + delay, within a moment of it).
    await expect
      .poll(async () => {
        const job = await publishJob(entry.id)
        return job
          ? Math.abs((job.run_at as Date).getTime() - new Date(later).getTime()) < 2_000
          : false
      })
      .toBe(true)
    const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM job_queue
      WHERE dedupe_key = ${`changelog-publish--${entry.id}`} AND status = 'pending'`
    expect(n).toBe(1)
    await admin.dispose()
  }
)

test(
  'CHG-A-11 a deleted scheduled entry is never announced, even when its job runs',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, {
      title: `${marker} deleted before`,
      state: { type: 'scheduled', publishAt: hoursFromNow(1) },
    })
    await expect.poll(() => publishJob(entry.id)).not.toBeNull()
    expect((await callServerFn(admin, 'deleteChangelogFn', { id: entry.id })).ok).toBe(true)
    await timeComes(entry.id)
    await runDue(request, entry.id)
    // The job ran and claimed nothing. The sweep only makes it due; the worker
    // runs it when it gets to it (pending, then running, then finished), so
    // wait for a finished state rather than for "no longer pending".
    const ran = await pollFor(
      `changelog-publish--${entry.id} to finish`,
      async () => {
        const [row] = await supportDb()`SELECT status FROM job_queue
          WHERE dedupe_key = ${`changelog-publish--${entry.id}`}
            AND status IN ('succeeded', 'failed')`
        return row ?? null
      },
      { timeoutMs: 20_000 }
    )
    expect(ran.status).toBe('succeeded')

    const control = await createEntry(admin, { title: `${marker} control`, state: 'published' })
    await waitForMail({ to: sub.email, subject: control.title })
    await waitForAnnouncementHandled(control.id)
    expect((await entryRow(entry.id)).notified_at).toBeNull()
    expect(await announcementEvents(entry.id)).toBe(0)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(0)
    expect(await publicIds(request)).not.toContain(entry.id)
    await admin.dispose()
  }
)
