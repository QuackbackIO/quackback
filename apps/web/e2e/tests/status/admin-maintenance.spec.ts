/**
 * Status admin: scheduled maintenance, from scheduling through the scheduler's
 * start and complete, start now, reschedule, move back and delete.
 *
 * Journeys: STA-A-34, STA-A-35, STA-A-36, STA-A-37, STA-A-38, STA-A-39,
 * STA-A-40, STA-A-42, STA-A-43, STA-A-44, STA-A-45, STA-A-46.
 *
 * The scheduler's handlers compare the window with the wall clock, so a test
 * backdates its own window's bounds and runs the `status-maintenance` sweep
 * (every overdue window in the workspace); it asserts only on its own rows.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor } from '../../support/db'
import {
  backdateWindow,
  createService,
  domainEvents,
  domainEventTypes,
  incidentRow,
  incidentUpdates,
  maintenanceJobs,
  messageOf,
  minutesFromNow,
  must,
  openAdmin,
  pickDateTime,
  postUpdate,
  publicSnapshot,
  runMaintenanceSweep,
  scheduleWindow,
  serviceEvents,
  serviceRow,
  toggleService,
  tryCreateIncident,
  deleteMadeIncidents,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
})
test.afterEach(async () => {
  await deleteMadeIncidents(admin)
  await admin.dispose()
})

const statusOf = async (id: string) => (await serviceRow(id)).status
const STARTED_TEXT = 'This scheduled maintenance is now in progress.'
const COMPLETED_TEXT = 'This scheduled maintenance is complete.'

test(
  'STA-A-34 schedule a maintenance window from the dialog',
  { tag: '@smoke' },
  async ({ asPerson, marker }) => {
    const svc = await createService(admin, `${marker} Database`)
    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=maintenance')
    await ui.getByRole('button', { name: 'Schedule maintenance' }).first().click()
    const dialog = ui.getByRole('dialog', { name: 'Schedule maintenance' })
    await expect(
      dialog.getByText('Appears on your status page and emails subscribers once, when scheduled.')
    ).toBeVisible()
    await dialog.getByLabel('Title').fill(`${marker} upgrade`)
    await dialog.getByLabel("What's planned?").fill('Upgrading the primary')
    await toggleService(dialog, svc.name)
    const tomorrow = new Date(Date.now() + 86_400_000)
    const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0)
    const end = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 12, 0)
    const picker = (label: string) =>
      dialog
        .locator('div.space-y-2', { has: ui.getByText(label, { exact: true }) })
        .getByRole('button')
    const pickers = { nth: (i: number) => picker(i === 0 ? 'Scheduled start' : 'Scheduled end') }
    // An end before the start keeps the button disabled.
    await pickDateTime(ui, pickers.nth(0), end)
    await pickDateTime(ui, pickers.nth(1), start)
    await expect(dialog.getByText('The end must be after the start.')).toBeVisible()
    const submit = dialog.getByRole('button', { name: 'Schedule maintenance' })
    await expect(submit).toBeDisabled()
    await pickDateTime(ui, pickers.nth(0), start)
    await pickDateTime(ui, pickers.nth(1), end)
    await expect(dialog.getByText('The end must be after the start.')).toBeHidden()
    // Auto-start and auto-complete are on by default.
    for (const sw of await dialog.getByRole('switch').all()) await expect(sw).toBeChecked()
    // Keep the publish email off: other tests' subscribers would get it.
    await dialog.getByRole('checkbox', { name: /Email subscribers/ }).click()
    await submit.click()

    await expect(dialog).toBeHidden()
    await expect(ui).toHaveURL(/view=maintenance/)
    await expect(ui).toHaveURL(/incident=status_incident_/)
    const id = new URL(ui.url()).searchParams.get('incident')!
    const row = await incidentRow(id)
    expect(row).toMatchObject({
      kind: 'maintenance',
      status: 'scheduled',
      impact: 'maintenance',
      auto_start: true,
      auto_complete: true,
    })
    expect(row.scheduled_start_at!.getTime()).toBe(start.getTime())
    expect(row.scheduled_end_at!.getTime()).toBe(end.getTime())
    expect(row.started_at.getTime()).toBe(start.getTime())
    expect(await statusOf(svc.id)).toBe('operational')
    expect(await domainEventTypes(id)).toEqual(['status.maintenance_scheduled'])
    const jobs = await maintenanceJobs(id)
    expect(jobs.map((j) => j.kind)).toEqual(['complete', 'start'])
    expect(
      Math.abs(jobs.find((j) => j.kind === 'start')!.runAt.getTime() - start.getTime())
    ).toBeLessThan(1_000)
    expect(
      Math.abs(jobs.find((j) => j.kind === 'complete')!.runAt.getTime() - end.getTime())
    ).toBeLessThan(1_000)
    const snap = await publicSnapshot(admin)
    expect(snap.upcomingMaintenance.map((w) => w.id)).toContain(id)
  }
)

test(
  'STA-A-35 STA-A-36 the scheduler starts a window at its start and completes it at its end',
  { tag: '@core' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Sched`)
    const w = await scheduleWindow(admin, {
      title: `${marker} window`,
      services: [[svc.id, 'under_maintenance']],
    })
    // Its start passes (only the start: both at once would start and complete it in one pass).
    const realStart = new Date(Date.now() - 1_000)
    await backdateWindow(w.id, { start: realStart })
    await runMaintenanceSweep(request)
    const started = await incidentRow(w.id)
    expect(started.status).toBe('in_progress')
    expect(Math.abs(started.started_at.getTime() - Date.now())).toBeLessThan(30_000)
    expect(await statusOf(svc.id)).toBe('under_maintenance')
    expect((await serviceEvents(svc.id)).map((e) => [e.status, e.source])).toEqual([
      ['under_maintenance', 'maintenance'],
    ])
    const timeline = await incidentUpdates(w.id)
    expect(timeline.map((u) => [u.status, u.body])).toEqual([
      ['scheduled', `First update for ${marker} window`],
      ['in_progress', STARTED_TEXT],
    ])
    const startEvent = (await domainEvents(w.id)).find(
      (e) => e.type === 'status.maintenance_started'
    )
    expect(startEvent?.actor_type).toBe('service')
    expect(startEvent?.payload).toMatchObject({
      incidentId: w.id,
      title: `${marker} window`,
      componentIds: [svc.id],
    })
    expect((await publicSnapshot(admin)).activeIncidents.map((i) => i.id)).toContain(w.id)

    // Its end passes.
    await backdateWindow(w.id, { end: new Date(Date.now() - 1_000) })
    await runMaintenanceSweep(request)
    const done = await incidentRow(w.id)
    expect(done.status).toBe('completed')
    expect(done.resolved_at).not.toBeNull()
    expect(await statusOf(svc.id)).toBe('operational')
    expect((await incidentUpdates(w.id)).at(-1)?.body).toBe(COMPLETED_TEXT)
    expect(await domainEventTypes(w.id)).toEqual([
      'status.maintenance_scheduled',
      'status.maintenance_started',
      'status.maintenance_completed',
    ])
    const snap = await publicSnapshot(admin)
    expect(snap.activeIncidents.map((i) => i.id)).not.toContain(w.id)
    expect(snap.upcomingMaintenance.map((i) => i.id)).not.toContain(w.id)
    // Recent incidents list incidents only; the window stays readable as history.
    const pub = await must<{ status: string }>(
      admin,
      'getStatusIncidentPublicFn',
      { id: w.id },
      { method: 'GET' }
    )
    expect(pub.status).toBe('completed')
  }
)

test(
  'STA-A-37 auto-start off: the window waits, then auto-complete finishes it',
  { tag: '@nightly' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Manual`)
    const w = await scheduleWindow(admin, {
      title: marker,
      services: [[svc.id, 'under_maintenance']],
      autoStart: false,
    })
    expect((await maintenanceJobs(w.id)).map((j) => j.kind)).toEqual(['complete'])
    await backdateWindow(w.id, { start: new Date(Date.now() - 60_000) })
    await runMaintenanceSweep(request)
    expect((await incidentRow(w.id)).status).toBe('scheduled')
    expect((await publicSnapshot(admin)).upcomingMaintenance.map((i) => i.id)).toContain(w.id)

    await backdateWindow(w.id, { end: new Date(Date.now() - 1_000) })
    await runMaintenanceSweep(request)
    const done = await incidentRow(w.id)
    expect(done.status).toBe('completed')
    expect(done.started_at.getTime()).toBeLessThanOrEqual(done.resolved_at!.getTime())
    expect(await serviceEvents(svc.id)).toEqual([])
    expect(await domainEventTypes(w.id)).toContain('status.maintenance_completed')
    expect(await domainEventTypes(w.id)).not.toContain('status.maintenance_started')
  }
)

test('STA-A-38 start now from the overview', { tag: '@core' }, async ({ asPerson, marker }) => {
  const svc = await createService(admin, `${marker} Now`)
  const w = await scheduleWindow(admin, {
    title: `${marker} soon`,
    services: [[svc.id, 'under_maintenance']],
    startMin: 3,
    endMin: 90,
  })
  const plannedEnd = (await incidentRow(w.id)).scheduled_end_at!
  const ui = await asPerson('admin')
  await openAdmin(ui, '/admin/status?view=overview')
  // The Upcoming maintenance card row: the window's title and its Start now.
  const row = ui
    .locator('div', { has: ui.getByRole('button', { name: `${marker} soon` }) })
    .filter({ has: ui.getByRole('button', { name: 'Start now' }) })
    .last()
  await row.getByRole('button', { name: 'Start now' }).click()
  const confirm = ui.getByRole('alertdialog').or(ui.getByRole('dialog'))
  await expect(confirm.getByText('Start maintenance now?')).toBeVisible()
  await expect(
    confirm.getByText(
      'The window begins immediately: affected services switch to Under maintenance on the public page and an update is posted to the timeline. Subscribers are not emailed.'
    )
  ).toBeVisible()
  await confirm.getByRole('button', { name: 'Start now' }).click()
  await expect(ui.getByText('Maintenance started').first()).toBeVisible({ timeout: 15_000 })

  const row2 = await pollFor('the start', async () => {
    const r = await incidentRow(w.id)
    return r.status === 'in_progress' ? r : null
  })
  expect(Math.abs(row2.started_at.getTime() - Date.now())).toBeLessThan(60_000)
  expect(row2.scheduled_end_at).toEqual(plannedEnd)
  expect(await statusOf(svc.id)).toBe('under_maintenance')
  expect((await incidentUpdates(w.id)).at(-1)?.body).toBe(STARTED_TEXT)
  const jobs = await maintenanceJobs(w.id)
  expect(jobs.map((j) => j.kind)).toEqual(['complete'])
  expect(Math.abs(jobs[0].runAt.getTime() - plannedEnd.getTime())).toBeLessThan(1_000)
  expect(await domainEventTypes(w.id)).toEqual([
    'status.maintenance_scheduled',
    'status.maintenance_started',
  ])

  // Again, on an incident, and on an unknown id.
  const again = await callServerFn(admin, 'startStatusMaintenanceNowFn', { id: w.id })
  expect(again.code).toBe('STATUS_MAINTENANCE_NOT_STARTABLE')
  expect(messageOf(again)).toBe('Only a scheduled maintenance window can be started now')
  const missing = await callServerFn(admin, 'startStatusMaintenanceNowFn', {
    id: 'status_incident_01m7v6aewge02vtv3kd36ggmcw',
  })
  expect(missing.code).toBe('STATUS_INCIDENT_NOT_FOUND')
  expect(messageOf(missing)).toBe('Maintenance not found')
})

test(
  'STA-A-39 start a window from the stepper with your own words',
  { tag: '@core' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Stepper`)
    const w = await scheduleWindow(admin, {
      title: marker,
      services: [[svc.id, 'under_maintenance']],
    })
    await postUpdate(admin, w.id, 'in_progress', `${marker} starting early`)
    const row = await incidentRow(w.id)
    expect(row.status).toBe('in_progress')
    const timeline = await incidentUpdates(w.id)
    expect(timeline.filter((u) => u.status === 'in_progress').map((u) => u.body)).toEqual([
      `${marker} starting early`,
    ])
    expect(timeline.at(-1)!.created_at.getTime()).toBe(row.started_at.getTime())
    expect(await statusOf(svc.id)).toBe('under_maintenance')
    expect((await maintenanceJobs(w.id)).map((j) => j.kind)).toEqual(['complete'])
    expect(await domainEventTypes(w.id)).toEqual([
      'status.maintenance_scheduled',
      'status.incident_updated',
      'status.maintenance_started',
    ])

    // A window the scheduler already started takes a plain update.
    const other = await scheduleWindow(admin, {
      title: `${marker} other`,
      services: [[svc.id, 'under_maintenance']],
    })
    await backdateWindow(other.id, { start: new Date(Date.now() - 1_000) })
    await runMaintenanceSweep(request)
    expect((await incidentRow(other.id)).status).toBe('in_progress')
    await postUpdate(admin, other.id, 'in_progress', 'still going')
    expect(
      (await domainEventTypes(other.id)).filter((t) => t === 'status.maintenance_started')
    ).toHaveLength(1)
  }
)

test('STA-A-40 reschedule a window', { tag: '@core' }, async ({ marker }) => {
  const svc = await createService(admin, `${marker} Move`)
  const w = await scheduleWindow(admin, {
    title: marker,
    services: [[svc.id, 'under_maintenance']],
  })
  const oldJobs = await maintenanceJobs(w.id)
  expect(oldJobs).toHaveLength(2)
  const newStart = minutesFromNow(240)
  const newEnd = minutesFromNow(300)
  await must(admin, 'updateStatusIncidentFn', {
    id: w.id,
    scheduledStartAt: newStart,
    scheduledEndAt: newEnd,
  })
  const row = await incidentRow(w.id)
  expect(row.started_at.getTime()).toBe(newStart.getTime())
  expect(row.details_edited_at).not.toBeNull()
  const jobs = await maintenanceJobs(w.id)
  expect(jobs.map((j) => j.kind)).toEqual(['complete', 'start'])
  expect(jobs[0].hash).not.toBe(oldJobs[0].hash)
  // The delay is computed from the clock, so allow a few ms.
  expect(
    Math.abs(jobs.find((j) => j.kind === 'start')!.runAt.getTime() - newStart.getTime())
  ).toBeLessThan(1_000)

  const bad = await callServerFn(admin, 'updateStatusIncidentFn', {
    id: w.id,
    scheduledStartAt: newEnd,
    scheduledEndAt: newStart,
  })
  expect(messageOf(bad)).toBe('The scheduled end must be after the scheduled start')
  expect((await incidentRow(w.id)).scheduled_start_at!.getTime()).toBe(newStart.getTime())
})

test(
  'STA-A-42 move a running window back, or reopen a completed one',
  { tag: '@nightly' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Back`)
    const w = await scheduleWindow(admin, {
      title: marker,
      services: [[svc.id, 'under_maintenance']],
    })
    const planned = (await incidentRow(w.id)).scheduled_start_at!
    const pastStart = new Date(Date.now() - 60_000)
    await backdateWindow(w.id, { start: pastStart })
    await runMaintenanceSweep(request)
    expect(await statusOf(svc.id)).toBe('under_maintenance')

    const back = await postUpdate(admin, w.id, 'scheduled', 'not yet')
    expect(back.autoStart).toBe(false)
    const row = await incidentRow(w.id)
    expect(row.status).toBe('scheduled')
    expect(row.started_at.getTime()).toBe(pastStart.getTime())
    expect(planned).not.toEqual(pastStart)
    expect(await statusOf(svc.id)).toBe('operational')
    // Only the end, still ahead, is armed.
    expect((await maintenanceJobs(w.id)).map((j) => j.kind)).toEqual(['complete'])

    // Complete it, let its end pass, then reopen it.
    await postUpdate(admin, w.id, 'completed', 'done')
    await backdateWindow(w.id, { end: new Date(Date.now() - 1_000) })
    const reopened = await postUpdate(admin, w.id, 'in_progress', 'back on')
    expect(reopened.autoComplete).toBe(false)
    const again = await incidentRow(w.id)
    expect(again.resolved_at).toBeNull()
    expect(await statusOf(svc.id)).toBe('under_maintenance')
  }
)

test(
  'STA-A-43 complete a window by hand before its end',
  { tag: '@core' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Early`)
    const w = await scheduleWindow(admin, {
      title: marker,
      services: [[svc.id, 'under_maintenance']],
    })
    await postUpdate(admin, w.id, 'in_progress', 'starting')
    await postUpdate(admin, w.id, 'completed', 'finished early')
    const row = await incidentRow(w.id)
    expect(row.status).toBe('completed')
    expect(row.resolved_at).not.toBeNull()
    expect(await statusOf(svc.id)).toBe('operational')
    expect((await domainEventTypes(w.id)).slice(-2)).toEqual([
      'status.incident_updated',
      'status.maintenance_completed',
    ])
    // Its auto-complete, when the end passes, does nothing more.
    await backdateWindow(w.id, { end: new Date(Date.now() - 1_000) })
    await runMaintenanceSweep(request)
    expect(
      (await domainEventTypes(w.id)).filter((x) => x === 'status.maintenance_completed')
    ).toHaveLength(1)
  }
)

test(
  'STA-A-44 the sweep catches a window whose start and end passed while down',
  { tag: '@nightly' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Missed`)
    const w = await scheduleWindow(admin, {
      title: marker,
      services: [[svc.id, 'under_maintenance']],
    })
    // Both bounds passed with nothing listening: no jobs left.
    await backdateWindow(w.id, {
      start: new Date(Date.now() - 2 * 60_000),
      end: new Date(Date.now() - 60_000),
    })
    await Promise.all([runMaintenanceSweep(request), runMaintenanceSweep(request)])
    expect((await incidentRow(w.id)).status).toBe('completed')
    expect((await incidentUpdates(w.id)).map((u) => u.body).slice(1)).toEqual([
      STARTED_TEXT,
      COMPLETED_TEXT,
    ])
    expect(await domainEventTypes(w.id)).toEqual([
      'status.maintenance_scheduled',
      'status.maintenance_started',
      'status.maintenance_completed',
    ])
    expect(await statusOf(svc.id)).toBe('operational')
  }
)

test('STA-A-45 delete a scheduled or running window', { tag: '@core' }, async ({ marker }) => {
  const svc = await createService(admin, `${marker} Gone`)
  const scheduled = await scheduleWindow(admin, {
    title: `${marker} scheduled`,
    services: [[svc.id, 'under_maintenance']],
  })
  expect(await maintenanceJobs(scheduled.id)).toHaveLength(2)
  await must(admin, 'deleteStatusIncidentFn', { id: scheduled.id })
  expect(await maintenanceJobs(scheduled.id)).toEqual([])
  expect(await serviceEvents(svc.id)).toEqual([])

  const running = await scheduleWindow(admin, {
    title: `${marker} running`,
    services: [[svc.id, 'under_maintenance']],
  })
  await postUpdate(admin, running.id, 'in_progress', 'go')
  expect(await statusOf(svc.id)).toBe('under_maintenance')
  await must(admin, 'deleteStatusIncidentFn', { id: running.id })
  expect(await statusOf(svc.id)).toBe('operational')
  expect(await maintenanceJobs(running.id)).toEqual([])
  const snap = await publicSnapshot(admin)
  const ids = [
    ...snap.activeIncidents,
    ...snap.upcomingMaintenance,
    ...snap.recentIncidents.flatMap((d) => d.incidents),
  ].map((i) => i.id)
  expect(ids).not.toContain(scheduled.id)
  expect(ids).not.toContain(running.id)
  expect((await incidentRow(running.id)).deleted_at).not.toBeNull()
})

test(
  'STA-A-46 a maintenance window with no dates is refused',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'createIncident (status.service.ts:183) accepts kind maintenance without scheduledStartAt/scheduledEndAt; the window never starts and its email reads "to"; see QUARANTINE.md',
    },
  },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} NoDates`)
    const res = await tryCreateIncident(admin, {
      kind: 'maintenance',
      title: marker,
      services: [[svc.id, 'under_maintenance']],
    })
    // A window accepted with no dates would sit in Upcoming forever: remove it.
    if (res.ok) await must(admin, 'deleteStatusIncidentFn', { id: res.data.id })
    expect(res.ok).toBe(false)
  }
)
