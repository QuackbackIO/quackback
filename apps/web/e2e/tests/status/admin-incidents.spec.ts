/**
 * Status admin: incidents, from report to resolve, reopen, backfill and delete.
 *
 * Journeys: STA-A-10, STA-A-17, STA-A-18, STA-A-19, STA-A-20, STA-A-21,
 * STA-A-22, STA-A-23, STA-A-24, STA-A-25, STA-A-26, STA-A-27, STA-A-28,
 * STA-A-29, STA-A-30, STA-A-31, STA-A-32, STA-A-33.
 *
 * Every test makes its own services (named by marker) and reads back only its
 * own rows: service status is workspace-wide.
 */
import type { APIRequestContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { personApi, callServerFn } from '../../support/server-fns'
import { pollFor } from '../../support/db'
import {
  createIncident,
  createService,
  domainEventTypes,
  domainEvents,
  getIncidentAdmin,
  messageOf,
  openAdmin,
  pickStatus,
  searchList,
  serviceChoice,
  toggleService,
  publicSnapshot,
  recentIds,
  incidentLinks,
  incidentRow,
  incidentUpdates,
  must,
  postUpdate,
  serviceEvents,
  serviceRow,
  setServiceStatus,
  tryCreateIncident,
} from '../../product/status'

// Browser journeys share the machine with the app under load: allow a minute.
test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
})
test.afterEach(async () => {
  await admin.dispose()
})

const statusOf = async (id: string) => (await serviceRow(id)).status

test.describe('report and lifecycle', () => {
  test(
    'STA-A-17 report an incident in the composer and see it live',
    { tag: '@smoke' },
    async ({ asPerson, people, page, marker }) => {
      const a = await createService(admin, `${marker} Web`)
      const b = await createService(admin, `${marker} Database`)
      const ui = await asPerson('admin')
      await openAdmin(ui, '/admin/status?view=open')
      await ui.getByRole('button', { name: 'Report incident' }).first().click()
      const dialog = ui.getByRole('dialog', { name: 'Report an incident' })
      await dialog.getByLabel('Title').fill(`${marker} outage`)
      await dialog.getByLabel("What's happening?").fill(`${marker} we are looking into it`)
      await toggleService(dialog, a.name)
      await toggleService(dialog, b.name)
      await pickStatus(ui, serviceChoice(dialog, b.name), 'Major outage')
      await expect(dialog.getByText(/Impact:\s*Critical/)).toBeVisible()
      // "Email subscribers" is on by default; turned off here so the publish
      // does not mail every other test's subscribers.
      const notify = dialog.getByRole('checkbox', { name: /Email subscribers/ })
      await expect(notify).toBeChecked()
      await expect(
        dialog.getByText('One email at publish. Updates and the resolve never email.')
      ).toBeVisible()
      await notify.click()
      await dialog.getByRole('button', { name: 'Publish incident' }).click()

      await expect(dialog).toBeHidden()
      await expect(ui).toHaveURL(/view=open/)
      await expect(ui).toHaveURL(/incident=status_incident_/)
      const id = new URL(ui.url()).searchParams.get('incident')!

      const row = await incidentRow(id)
      expect(row).toMatchObject({
        kind: 'incident',
        title: `${marker} outage`,
        status: 'investigating',
        impact: 'critical',
        impact_override: false,
        resolved_at: null,
        backfilled: false,
        created_by: toUuid(people.people.admin.principalId as `principal_${string}`),
      })
      expect(Date.now() - row.started_at.getTime()).toBeLessThan(60_000)
      expect(row.notified_at).not.toBeNull()
      expect(await incidentUpdates(id)).toEqual([
        expect.objectContaining({
          status: 'investigating',
          body: `${marker} we are looking into it`,
        }),
      ])
      expect(await incidentLinks(id)).toHaveLength(2)
      expect(await statusOf(a.id)).toBe('degraded_performance')
      expect(await statusOf(b.id)).toBe('major_outage')
      for (const [svc, status] of [
        [a, 'degraded_performance'],
        [b, 'major_outage'],
      ] as const) {
        expect(await serviceEvents(svc.id)).toEqual([
          expect.objectContaining({ status, source: 'incident', incident_id: toUuid(id as never) }),
        ])
      }
      expect(await domainEventTypes(id)).toEqual(['status.incident_created'])

      // Publicly the incident is live.
      await page.goto('/status')
      await expect(page.getByText(`${marker} outage`).first()).toBeVisible()
    }
  )

  test(
    'STA-A-21 resolving from the stepper restores the affected services',
    { tag: '@smoke' },
    async ({ asPerson, page, marker }) => {
      const svc = await createService(admin, `${marker} Checkout`)
      const inc = await createIncident(admin, {
        title: `${marker} checkout down`,
        services: [[svc.id, 'major_outage']],
      })
      const ui = await asPerson('admin')
      await openAdmin(ui, `/admin/status?view=open&incident=${inc.id}`)
      await ui.getByRole('radio', { name: /Resolved/ }).click()
      await expect(ui.getByRole('button', { name: 'Post update & resolve' })).toBeVisible()
      const restore = ui.getByRole('checkbox', { name: 'Restore affected services to operational' })
      await expect(restore).toBeChecked()
      await ui
        .getByPlaceholder("What's the latest? This appears on the public status page.")
        .fill(`${marker} fixed`)
      await ui.getByRole('button', { name: 'Post update & resolve' }).click()
      await expect(ui.getByText('Update posted').first()).toBeVisible({ timeout: 15_000 })

      const row = await pollFor('the resolve', async () => {
        const r = await incidentRow(inc.id)
        return r.status === 'resolved' ? r : null
      })
      expect(row.resolved_at).not.toBeNull()
      expect(await statusOf(svc.id)).toBe('operational')
      expect((await serviceEvents(svc.id)).map((e) => [e.status, e.source])).toEqual([
        ['major_outage', 'incident'],
        ['operational', 'incident'],
      ])
      const events = await domainEvents(inc.id)
      expect(events.map((e) => e.type)).toEqual([
        'status.incident_created',
        'status.incident_updated',
      ])
      expect(events[1].payload).toMatchObject({ status: 'resolved' })

      // Gone from the Open list; publicly listed as past, not active.
      await ui.keyboard.press('Escape')
      await openAdmin(ui, '/admin/status?view=open')
      await searchList(ui, marker, ui.getByText('No incidents match your search'))
      const snapshot = await publicSnapshot(admin)
      expect(snapshot.activeIncidents.map((i) => i.id)).not.toContain(inc.id)
      expect(recentIds(snapshot)).toContain(inc.id)
      await page.goto(`/status/${inc.id}`)
      await expect(page.getByText(`${marker} fixed`)).toBeVisible()
    }
  )

  test(
    'STA-A-20 posting through the stepper advances the incident',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const svc = await createService(admin, `${marker} Search`)
      const inc = await createIncident(admin, {
        title: `${marker} slow search`,
        services: [[svc.id, 'partial_outage']],
      })
      const ui = await asPerson('admin')
      await openAdmin(ui, `/admin/status?view=open&incident=${inc.id}`)
      const composer = ui.getByPlaceholder(
        "What's the latest? This appears on the public status page."
      )

      await ui.getByRole('radio', { name: /Identified/ }).click()
      await composer.fill(`${marker} found it`)
      await ui.getByRole('button', { name: 'Post update & mark as Identified' }).click()
      await expect(ui.getByText('Update posted').first()).toBeVisible({ timeout: 15_000 })
      await expect(composer).toHaveValue('')
      // The stepper moves on to the next stage.
      await expect(ui.getByRole('radio', { name: /Monitoring/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await composer.fill(`${marker} watching`)
      await ui.getByRole('button', { name: 'Post update & mark as Monitoring' }).click()

      await pollFor('two updates', async () =>
        (await incidentUpdates(inc.id)).length === 3 ? true : null
      )
      expect((await incidentUpdates(inc.id)).map((u) => [u.status, u.body])).toEqual([
        ['investigating', `First update for ${marker} slow search`],
        ['identified', `${marker} found it`],
        ['monitoring', `${marker} watching`],
      ])
      const row = await incidentRow(inc.id)
      expect(row.status).toBe('monitoring')
      expect(row.updated_at.getTime()).toBeGreaterThan(row.created_at.getTime())
      const updated = (await domainEvents(inc.id)).filter(
        (e) => e.type === 'status.incident_updated'
      )
      expect(updated.map((e) => e.payload)).toEqual([
        expect.objectContaining({
          incidentId: inc.id,
          kind: 'incident',
          status: 'identified',
          body: `${marker} found it`,
        }),
        expect.objectContaining({
          incidentId: inc.id,
          kind: 'incident',
          status: 'monitoring',
          body: `${marker} watching`,
        }),
      ])
      // The hold did not change, so the service did not move.
      expect(await statusOf(svc.id)).toBe('partial_outage')
      expect(await serviceEvents(svc.id)).toHaveLength(1)
    }
  )

  test(
    'STA-A-10 a hand-set status on a held service stays until the resolve recomputes it',
    { tag: '@core' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Held`)
      const inc = await createIncident(admin, {
        title: marker,
        services: [[svc.id, 'major_outage']],
      })
      await setServiceStatus(admin, svc.id, 'operational')
      await postUpdate(admin, inc.id, 'identified', 'still open')
      expect(await statusOf(svc.id)).toBe('operational')

      // Another open incident holds it at degraded; the resolve takes that.
      const other = await createIncident(admin, {
        title: `${marker} other`,
        services: [[svc.id, 'degraded_performance']],
      })
      await setServiceStatus(admin, svc.id, 'operational')
      await postUpdate(admin, inc.id, 'resolved', 'done')
      expect(await statusOf(svc.id)).toBe('degraded_performance')
      await postUpdate(admin, other.id, 'resolved', 'done too')
      expect(await statusOf(svc.id)).toBe('operational')
    }
  )

  test(
    'STA-A-22 resolving without restore keeps the service status',
    { tag: '@core' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Partial`)
      const inc = await createIncident(admin, {
        title: marker,
        services: [[svc.id, 'partial_outage']],
      })
      await postUpdate(admin, inc.id, 'resolved', 'mostly back', { skipRestore: true })
      expect((await incidentRow(inc.id)).status).toBe('resolved')
      expect(await statusOf(svc.id)).toBe('partial_outage')
      expect(await serviceEvents(svc.id)).toHaveLength(1)

      // A later recompute on the service sets it from the open incidents.
      const next = await createIncident(admin, {
        title: `${marker} next`,
        services: [[svc.id, 'degraded_performance']],
      })
      await postUpdate(admin, next.id, 'resolved', 'all good')
      expect(await statusOf(svc.id)).toBe('operational')
    }
  )

  test(
    'STA-A-23 two open incidents on one service: the worst wins and the rest survive a resolve',
    { tag: '@core' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Shared`)
      const one = await createIncident(admin, {
        title: `${marker} 1`,
        services: [[svc.id, 'degraded_performance']],
      })
      const two = await createIncident(admin, {
        title: `${marker} 2`,
        services: [[svc.id, 'major_outage']],
      })
      expect(await statusOf(svc.id)).toBe('major_outage')
      await postUpdate(admin, two.id, 'resolved', 'two fixed')
      expect(await statusOf(svc.id)).toBe('degraded_performance')
      await postUpdate(admin, one.id, 'resolved', 'one fixed')
      expect(await statusOf(svc.id)).toBe('operational')
      expect((await serviceEvents(svc.id)).map((e) => e.status)).toEqual([
        'degraded_performance',
        'major_outage',
        'degraded_performance',
        'operational',
      ])
    }
  )

  test(
    'STA-A-24 reopening a resolved incident holds its services again',
    { tag: '@core' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Reopen`)
      const inc = await createIncident(admin, {
        title: marker,
        services: [[svc.id, 'major_outage']],
      })
      await postUpdate(admin, inc.id, 'resolved', 'fixed')
      const firstResolve = (await incidentRow(inc.id)).resolved_at!
      expect(await statusOf(svc.id)).toBe('operational')

      await postUpdate(admin, inc.id, 'investigating', 'it is back')
      const reopened = await incidentRow(inc.id)
      expect(reopened.status).toBe('investigating')
      expect(reopened.resolved_at).toBeNull()
      expect(await statusOf(svc.id)).toBe('major_outage')
      const active = await publicSnapshot(admin)
      expect(active.activeIncidents.map((i) => i.id)).toContain(inc.id)
      const open = await must<{ items: { id: string }[] }>(
        admin,
        'listStatusIncidentsAdminFn',
        { kind: 'incident', state: 'active', search: marker },
        { method: 'GET' }
      )
      expect(open.items.map((i) => i.id)).toEqual([inc.id])
      expect(await domainEventTypes(inc.id)).toEqual([
        'status.incident_created',
        'status.incident_updated',
        'status.incident_updated',
      ])

      await postUpdate(admin, inc.id, 'resolved', 'fixed again')
      const second = (await incidentRow(inc.id)).resolved_at!
      expect(second.getTime()).toBeGreaterThan(firstResolve.getTime())
    }
  )

  test(
    'STA-A-25 a note on a resolved incident changes nothing else',
    { tag: '@nightly' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Note`)
      const inc = await createIncident(admin, {
        title: marker,
        services: [[svc.id, 'major_outage']],
      })
      await postUpdate(admin, inc.id, 'resolved', 'fixed')
      const resolvedAt = (await incidentRow(inc.id)).resolved_at!
      await setServiceStatus(admin, svc.id, 'partial_outage')
      await postUpdate(admin, inc.id, 'resolved', 'postscript')
      expect((await incidentRow(inc.id)).resolved_at).toEqual(resolvedAt)
      expect(await incidentUpdates(inc.id)).toHaveLength(3)
      expect(await statusOf(svc.id)).toBe('partial_outage')
      expect(
        (await domainEventTypes(inc.id)).filter((t) => t === 'status.incident_updated')
      ).toHaveLength(2)
    }
  )
})

test.describe('refusals and impact', () => {
  test('STA-A-18 report-incident refusals write nothing', { tag: '@core' }, async ({ marker }) => {
    const svc = await createService(admin, `${marker} Refuse`)
    const base = {
      title: marker,
      services: [[svc.id, 'major_outage']] as [string, 'major_outage'][],
    }

    // Zod: empty title, empty body, no services.
    for (const bad of [
      { ...base, title: '' },
      { ...base, body: '' },
      { ...base, services: [] },
    ]) {
      const res = await tryCreateIncident(admin, bad)
      expect(res.ok, JSON.stringify(bad)).toBe(false)
    }
    const blankTitle = await tryCreateIncident(admin, { ...base, title: '   ' })
    expect(blankTitle.code).toBe('VALIDATION_ERROR')
    expect(blankTitle.raw).toContain('Title is required')
    const blankBody = await tryCreateIncident(admin, { ...base, body: '   ' })
    expect(blankBody.raw).toContain('Update body is required')
    const wrongStatus = await tryCreateIncident(admin, { ...base, status: 'scheduled' })
    expect(wrongStatus.code).toBe('VALIDATION_ERROR')
    expect(messageOf(wrongStatus)).toBe(
      '"scheduled" is not an incident status. Use one of: investigating, identified, monitoring, resolved.'
    )
    const gone = await createService(admin, `${marker} Gone`)
    await must(admin, 'deleteStatusComponentFn', { id: gone.id })
    const deleted = await tryCreateIncident(admin, {
      ...base,
      services: [
        [svc.id, 'major_outage'],
        [gone.id, 'major_outage'],
      ],
    })
    expect(deleted.raw).toContain(
      'An affected service has been deleted. Choose the services again.'
    )
    const order = await tryCreateIncident(admin, {
      ...base,
      kind: 'maintenance',
      status: 'scheduled',
      scheduledStartAt: new Date(Date.now() + 2 * 3600_000),
      scheduledEndAt: new Date(Date.now() + 3600_000),
    })
    expect(order.raw).toContain('The scheduled end must be after the scheduled start')

    // Nothing was written: no incident by that title and the service never moved.
    const list = await must<{ items: unknown[] }>(
      admin,
      'listStatusIncidentsAdminFn',
      { state: 'all', search: marker },
      { method: 'GET' }
    )
    expect(list.items).toEqual([])
    expect(await statusOf(svc.id)).toBe('operational')
    expect(await serviceEvents(svc.id)).toEqual([])
  })

  test(
    'STA-A-19 impact is derived from the worst status unless pinned',
    { tag: '@core' },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Impact`)
      const other = await createService(admin, `${marker} Impact 2`)
      for (const [status, impact] of [
        ['degraded_performance', 'minor'],
        ['partial_outage', 'major'],
        ['major_outage', 'critical'],
        ['under_maintenance', 'none'],
      ] as const) {
        const inc = await createIncident(admin, {
          title: `${marker} ${status}`,
          services: [[svc.id, status]],
        })
        expect(inc.impact, status).toBe(impact)
        expect(inc.impactOverride).toBe(false)
      }
      // An unpinned incident re-derives on a services edit.
      const unpinned = await createIncident(admin, {
        title: `${marker} unpinned`,
        services: [[other.id, 'degraded_performance']],
      })
      const rederived = await must<{ impact: string }>(admin, 'updateStatusIncidentFn', {
        id: unpinned.id,
        affectedComponents: [{ componentId: other.id, componentStatus: 'major_outage' }],
      })
      expect(rederived.impact).toBe('critical')
      // A pinned impact stays when services change.
      const pinned = await createIncident(admin, {
        title: `${marker} pinned`,
        services: [[other.id, 'major_outage']],
        impact: 'minor',
        impactOverride: true,
      })
      expect(pinned.impact).toBe('minor')
      const edited = await must<{ impact: string; impactOverride: boolean }>(
        admin,
        'updateStatusIncidentFn',
        {
          id: pinned.id,
          affectedComponents: [{ componentId: other.id, componentStatus: 'partial_outage' }],
        }
      )
      expect(edited).toMatchObject({ impact: 'minor', impactOverride: true })
      expect((await incidentRow(pinned.id)).impact).toBe('minor')
    }
  )
})

test.describe('editing', () => {
  test(
    'STA-A-26 sidebar edits autosave and apply live',
    { tag: '@core' },
    async ({ asPerson, page, marker }) => {
      const a = await createService(admin, `${marker} Edit A`)
      const b = await createService(admin, `${marker} Edit B`)
      const inc = await createIncident(admin, {
        title: `${marker} before`,
        services: [[a.id, 'major_outage']],
      })
      expect((await incidentRow(inc.id)).details_edited_at).toBeNull()

      const ui = await asPerson('admin')
      await openAdmin(ui, `/admin/status?view=open&incident=${inc.id}`)
      await expect(ui.getByText('Details save automatically.')).toBeVisible()
      const titleBox = ui
        .locator('div', { has: ui.locator('p', { hasText: /^Title$/ }) })
        .last()
        .locator('input')
      await titleBox.fill(`${marker} after`)
      await expect(ui.getByText('Saved', { exact: true })).toBeVisible()
      await pollFor('the title to save', async () =>
        (await incidentRow(inc.id)).title === `${marker} after` ? true : null
      )
      const stamped = (await incidentRow(inc.id)).details_edited_at
      expect(stamped).not.toBeNull()

      // Add B (live on an open incident) and remove A (recomputed).
      const sidebar = ui
        .locator('div', { has: ui.locator('p', { hasText: /^Affected services$/ }) })
        .last()
      await toggleService(sidebar, b.name)
      await pollFor('B to be held', async () =>
        (await statusOf(b.id)) === 'degraded_performance' ? true : null
      )
      await toggleService(sidebar, a.name)
      await pollFor('A to be released', async () =>
        (await statusOf(a.id)) === 'operational' ? true : null
      )

      // An impact-only change does not stamp details_edited_at.
      const before = (await incidentRow(inc.id)).details_edited_at!
      await must(admin, 'updateStatusIncidentFn', {
        id: inc.id,
        impact: 'minor',
        impactOverride: true,
      })
      expect((await incidentRow(inc.id)).details_edited_at).toEqual(before)
      // Re-sending the same values does not stamp it either.
      await must(admin, 'updateStatusIncidentFn', { id: inc.id, title: `${marker} after` })
      expect((await incidentRow(inc.id)).details_edited_at).toEqual(before)

      // No webhook event for edits; the public title follows.
      expect(await domainEventTypes(inc.id)).toEqual(['status.incident_created'])
      await page.goto(`/status/${inc.id}`)
      await expect(page.getByRole('heading', { name: `${marker} after` })).toBeVisible()
    }
  )

  test(
    'STA-A-27 editing services on a resolved incident leaves live statuses alone',
    { tag: '@nightly' },
    async ({ marker }) => {
      const a = await createService(admin, `${marker} Res A`)
      const s = await createService(admin, `${marker} Res S`)
      const inc = await createIncident(admin, { title: marker, services: [[a.id, 'major_outage']] })
      await postUpdate(admin, inc.id, 'resolved', 'done')
      await must(admin, 'updateStatusIncidentFn', {
        id: inc.id,
        affectedComponents: [
          { componentId: a.id, componentStatus: 'major_outage' },
          { componentId: s.id, componentStatus: 'major_outage' },
        ],
      })
      expect((await incidentLinks(inc.id)).map((l) => l.component_id)).toContain(
        toUuid(s.id as never)
      )
      expect(await statusOf(s.id)).toBe('operational')
      expect(await serviceEvents(s.id)).toEqual([])
    }
  )
})

test.describe('backfill and already-resolved', () => {
  test('STA-A-28 log a past incident', { tag: '@core' }, async ({ asPerson, marker }) => {
    const svc = await createService(admin, `${marker} Past`)
    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=open')
    await ui.getByRole('button', { name: 'Report incident' }).first().click()
    await ui.getByRole('button', { name: 'Log a past incident instead' }).click()
    const dialog = ui.getByRole('dialog', { name: 'Log a past incident' })
    await expect(
      dialog.getByText(
        'Adds a resolved incident to your incident history. It does not change uptime or service status, and subscribers are not emailed.'
      )
    ).toBeVisible()
    await dialog.getByLabel('Title').fill(`${marker} last week`)
    await dialog.getByLabel("What's happening?").fill('It happened')
    await toggleService(dialog, svc.name)
    // No dates yet: the button stays disabled.
    await expect(dialog.getByRole('button', { name: 'Log past incident' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // The dates go through the server fn (the date-time picker is a calendar widget).
    const startedAt = new Date(Date.now() - 3 * 86_400_000)
    const resolvedAt = new Date(Date.now() - 3 * 86_400_000 + 3_600_000)
    const inc = await createIncident(admin, {
      title: `${marker} last week`,
      status: 'resolved',
      services: [[svc.id, 'major_outage']],
      backfill: { startedAt, resolvedAt },
    })
    const row = await incidentRow(inc.id)
    expect(row).toMatchObject({
      status: 'resolved',
      backfilled: true,
      notified_at: null,
      notify_subscribers: false,
    })
    expect(row.started_at.toISOString()).toBe(startedAt.toISOString())
    expect(row.resolved_at!.toISOString()).toBe(resolvedAt.toISOString())
    expect((await incidentUpdates(inc.id))[0].created_at.toISOString()).toBe(
      resolvedAt.toISOString()
    )
    expect(await statusOf(svc.id)).toBe('operational')
    expect(await serviceEvents(svc.id)).toEqual([])
    expect(await domainEventTypes(inc.id)).toEqual([])

    await openAdmin(ui, `/admin/status?view=all&incident=${inc.id}`)
    await expect(ui.getByText('Backfilled incident: subscribers were never emailed.')).toBeVisible()
    expect(recentIds(await publicSnapshot(admin))).toContain(inc.id)
  })

  test('STA-A-29 backfill refusals', { tag: '@core' }, async ({ marker }) => {
    const svc = await createService(admin, `${marker} Backfill`)
    const base = {
      title: marker,
      services: [[svc.id, 'major_outage']] as [string, 'major_outage'][],
    }
    const t0 = new Date(Date.now() - 86_400_000)
    const outOfOrder = await tryCreateIncident(admin, {
      ...base,
      status: 'resolved',
      backfill: { startedAt: t0, resolvedAt: new Date(t0.getTime() - 60_000) },
    })
    expect(outOfOrder.raw).toContain('A past incident must be resolved after it started')
    const live = await tryCreateIncident(admin, {
      ...base,
      status: 'investigating',
      backfill: { startedAt: t0, resolvedAt: new Date(t0.getTime() + 60_000) },
    })
    expect(messageOf(live)).toBe(
      'A past incident is logged as resolved. Use the "resolved" status.'
    )

    const past = await createIncident(admin, {
      ...base,
      status: 'resolved',
      backfill: { startedAt: t0, resolvedAt: new Date(t0.getTime() + 60_000) },
    })
    const reopen = await callServerFn(admin, 'postStatusIncidentUpdateFn', {
      id: past.id,
      status: 'investigating',
      body: 'reopen',
    })
    expect(reopen.ok).toBe(false)
    expect(reopen.raw).toContain(
      "A logged past incident can't be reopened. Report a new incident instead."
    )
    expect((await incidentRow(past.id)).status).toBe('resolved')
  })

  test(
    'STA-A-30 an incident created already resolved announces nothing',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'createIncident (status.service.ts:242) defaults notifySubscribers to true for a non-backfill row created already resolved, so it announces status.incident_created for something already over; see QUARANTINE.md',
      },
    },
    async ({ marker }) => {
      const svc = await createService(admin, `${marker} Over`)
      const inc = await createIncident(admin, {
        title: marker,
        status: 'resolved',
        services: [[svc.id, 'major_outage']],
        notifySubscribers: true,
      })
      const row = await incidentRow(inc.id)
      expect(row.resolved_at).not.toBeNull()
      expect(await statusOf(svc.id)).toBe('operational')
      expect(await serviceEvents(svc.id)).toEqual([])
      expect(await domainEventTypes(inc.id)).not.toContain('status.incident_created')
    }
  )
})

test.describe('delete and lists', () => {
  test(
    'STA-A-31 delete an incident from the list',
    { tag: '@core' },
    async ({ asPerson, page, marker }) => {
      const svc = await createService(admin, `${marker} Del`)
      const keep = await createIncident(admin, {
        title: `${marker} keep`,
        services: [[svc.id, 'degraded_performance']],
      })
      const inc = await createIncident(admin, {
        title: `${marker} delete me`,
        services: [[svc.id, 'major_outage']],
      })
      expect(await statusOf(svc.id)).toBe('major_outage')

      const ui = await asPerson('admin')
      await openAdmin(ui, '/admin/status?view=open')
      await searchList(
        ui,
        `${marker} delete`,
        ui.getByRole('heading', { name: `${marker} delete me` })
      )
      const row = ui.locator('div.group', { hasText: `${marker} delete me` })
      await row.hover()
      await row.getByRole('button').click()
      await ui.getByRole('menuitem', { name: 'Delete' }).click()
      const confirm = ui.getByRole('alertdialog').or(ui.getByRole('dialog'))
      await expect(confirm.getByText('Delete incident?')).toBeVisible()
      await expect(
        confirm.getByText(
          'It will be removed from your status page and incident history. Any services it affects go back to the status set by your other open incidents.'
        )
      ).toBeVisible()
      await confirm.getByRole('button', { name: 'Delete' }).click()
      await pollFor('the delete', async () =>
        (await incidentRow(inc.id)).deleted_at ? true : null
      )

      // Its service falls back to the other open incident.
      expect(await statusOf(svc.id)).toBe('degraded_performance')
      expect(await domainEventTypes(inc.id)).toEqual(['status.incident_created'])
      await page.goto(`/status/${inc.id}`)
      await expect(page.getByText('Incident not found')).toBeVisible()
      const again = await callServerFn(admin, 'deleteStatusIncidentFn', { id: inc.id })
      expect(again.ok).toBe(false)
      expect(again.code).toBe('STATUS_INCIDENT_NOT_FOUND')
      expect((await incidentRow(keep.id)).deleted_at).toBeNull()
    }
  )

  test(
    'STA-A-32 incident lists: tabs, search and sort',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      const svc = await createService(admin, `${marker} List`)
      // Critical first, so newest-first puts minor on top and the Impact sort flips it.
      await createIncident(admin, {
        title: `${marker} critical one`,
        services: [[svc.id, 'major_outage']],
      })
      await createIncident(admin, {
        title: `${marker} minor one`,
        services: [[svc.id, 'degraded_performance']],
      })
      const resolved = await createIncident(admin, {
        title: `${marker} resolved one`,
        services: [[svc.id, 'partial_outage']],
      })
      await postUpdate(admin, resolved.id, 'resolved', `${marker}-needle-in-body`)

      const ui = await asPerson('admin')
      await openAdmin(ui, '/admin/status?view=open')
      await searchList(ui, marker, ui.getByRole('heading', { name: `${marker} minor one` }))
      await expect(ui.getByRole('heading', { name: `${marker} critical one` })).toBeVisible()
      await expect(ui.getByRole('heading', { name: `${marker} resolved one` })).toHaveCount(0)
      const titles = ui.locator('h3', { hasText: marker })
      await expect(titles).toHaveText([`${marker} minor one`, `${marker} critical one`])
      await ui.getByRole('button', { name: /Newest/ }).click()
      await ui.getByRole('menuitemradio', { name: 'Impact' }).click()
      await expect(titles).toHaveText([`${marker} critical one`, `${marker} minor one`])

      // Search matches an update body, case-insensitively, on All.
      await openAdmin(ui, '/admin/status?view=all')
      await searchList(
        ui,
        `${marker}-NEEDLE`.toUpperCase(),
        ui.getByRole('heading', { name: `${marker} resolved one` })
      )
      await expect(titles).toHaveCount(1)
      await ui.getByPlaceholder('Search incidents…').fill(`${marker}-nothing-here`)
      await expect(ui.getByText('No incidents match your search')).toBeVisible()
    }
  )

  test(
    'STA-A-33 editor deep link to a deleted incident says not found',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      const svc = await createService(admin, `${marker} Missing`)
      const inc = await createIncident(admin, {
        title: marker,
        services: [[svc.id, 'degraded_performance']],
      })
      await must(admin, 'deleteStatusIncidentFn', { id: inc.id })
      expect(await getIncidentAdmin(admin, inc.id)).toBeNull()
      const ui = await asPerson('admin')
      await openAdmin(ui, `/admin/status?incident=${inc.id}`)
      await expect(ui.getByRole('heading', { name: 'Incident not found' })).toBeVisible()
      await expect(ui.getByText('It may have been deleted, or the link is wrong.')).toBeVisible()
    }
  )

  test(
    'STA-A-33 editor deep link to a malformed id says not found',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'findStatusIncidentById (status.service.ts:866) throws on a malformed id instead of returning null, so the editor shows "Couldn\'t load this incident"; see QUARANTINE.md',
      },
    },
    async ({ asPerson }) => {
      const res = await callServerFn(
        admin,
        'getStatusIncidentAdminFn',
        { id: 'not-an-id' },
        { method: 'GET' }
      )
      expect(res.ok, res.raw.slice(0, 300)).toBe(true)
      expect(res.data).toBeNull()
      const ui = await asPerson('admin')
      await openAdmin(ui, '/admin/status?incident=not-an-id')
      await expect(ui.getByRole('heading', { name: 'Incident not found' })).toBeVisible()
    }
  )
})
