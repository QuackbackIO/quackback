/**
 * Status admin: services and groups.
 *
 * Journeys: STA-A-06, STA-A-07, STA-A-08, STA-A-09, STA-A-11, STA-A-12,
 * STA-A-13, STA-A-14.
 *
 * Service lists are workspace-wide: each test finds its own services and
 * groups by marker and compares only their relative order.
 */
import type { APIRequestContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import {
  createIncident,
  createService,
  domainEvents,
  getIncidentAdmin,
  messageOf,
  must,
  openAdmin,
  postUpdate,
  publicServiceIds,
  publicSnapshot,
  searchList,
  serviceEvents,
  serviceRow,
  setServiceStatus,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
})
test.afterEach(async () => {
  await admin.dispose()
})

async function serviceByName(name: string) {
  return pollFor(`service ${name}`, async () => {
    const [row] = await supportDb()<
      {
        id: string
        status: string
        position: number
        show_uptime: boolean
        description: string | null
        group_id: string | null
        deleted_at: Date | null
      }[]
    >`
      SELECT id, status, position, show_uptime, description, group_id, deleted_at
      FROM status_components WHERE name = ${name}`
    return row ?? null
  })
}

test(
  'STA-A-06 create a service from the Services view',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const before = await createService(admin, `${marker} Before`)
    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=components')
    await ui.getByRole('button', { name: 'New service' }).click()
    const dialog = ui.getByRole('dialog', { name: 'New service' })
    await dialog.getByLabel('Name').fill(`${marker} API`)
    await dialog.getByLabel('Description').fill('The public API')
    await dialog.getByRole('button', { name: 'Create service' }).click()
    await expect(dialog).toBeHidden()

    const row = await serviceByName(`${marker} API`)
    expect(row).toMatchObject({
      status: 'operational',
      description: 'The public API',
      group_id: null,
      show_uptime: true,
    })
    expect(row.position).toBeGreaterThan((await serviceRow(before.id)).position)
    expect(
      await supportDb()`SELECT 1 FROM status_component_events WHERE component_id = ${row.id}`
    ).toHaveLength(0)
    await searchList(
      ui,
      `${marker} API`,
      ui.getByText(`${marker} API`, { exact: true }),
      'Search services…'
    )
    const snap = await publicSnapshot(admin)
    expect(snap.ungroupedComponents.map((c) => c.name)).toContain(`${marker} API`)
  }
)

test(
  'STA-A-07 service and group name refusals write nothing',
  { tag: '@nightly' },
  async ({ marker }) => {
    for (const name of ['', 'x'.repeat(201)]) {
      expect((await callServerFn(admin, 'createStatusComponentFn', { name })).ok).toBe(false)
      expect((await callServerFn(admin, 'createStatusGroupFn', { name })).ok).toBe(false)
    }
    const blankSvc = await callServerFn(admin, 'createStatusComponentFn', { name: '   ' })
    expect(messageOf(blankSvc)).toBe('Component name is required')
    const blankGroup = await callServerFn(admin, 'createStatusGroupFn', { name: '   ' })
    expect(messageOf(blankGroup)).toBe('Group name is required')
    const svc = await createService(admin, `${marker} Named`)
    const rename = await callServerFn(admin, 'updateStatusComponentFn', { id: svc.id, name: '  ' })
    expect(messageOf(rename)).toBe('Component name is required')
    expect((await serviceRow(svc.id)).name).toBe(`${marker} Named`)
    const blanks = await supportDb()`SELECT 1 FROM status_components WHERE btrim(name) = ''`
    expect(blanks).toHaveLength(0)
  }
)

test('STA-A-08 edit a service', { tag: '@nightly' }, async ({ asPerson, marker }) => {
  const svc = await createService(admin, `${marker} Old`)
  const ui = await asPerson('admin')
  await openAdmin(ui, '/admin/status?view=components')
  await searchList(
    ui,
    `${marker} Old`,
    ui.getByText(`${marker} Old`, { exact: true }),
    'Search services…'
  )
  const row = ui.locator('div.group', { hasText: `${marker} Old` }).last()
  await row.hover()
  await row.getByTitle('Service actions').click()
  await ui.getByRole('menuitem', { name: 'Edit service' }).click()
  const dialog = ui.getByRole('dialog', { name: 'Edit service' })
  await dialog.getByLabel('Name').fill(`${marker} New`)
  await dialog.getByLabel('Description').fill('Renamed')
  await dialog.getByRole('switch').click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()

  await pollFor('the edit', async () =>
    (await serviceRow(svc.id)).name === `${marker} New` ? true : null
  )
  expect(await serviceRow(svc.id)).toMatchObject({ description: 'Renamed', show_uptime: false })
  expect(await serviceEvents(svc.id)).toEqual([])
  const snap = await publicSnapshot(admin)
  const pub = snap.ungroupedComponents.find((c) => c.id === svc.id)
  expect(pub).toMatchObject({ name: `${marker} New`, showUptime: false })
})

test('STA-A-09 set a service status by hand', { tag: '@core' }, async ({ marker }) => {
  const svc = await createService(admin, `${marker} Manual`)
  await setServiceStatus(admin, svc.id, 'partial_outage')
  expect((await serviceRow(svc.id)).status).toBe('partial_outage')
  expect(await serviceEvents(svc.id)).toEqual([
    expect.objectContaining({ status: 'partial_outage', source: 'manual', incident_id: null }),
  ])
  const events = await domainEvents(svc.id)
  expect(events.map((e) => e.type)).toEqual(['status.component_changed'])
  expect(events[0].actor_type).toBe('service')
  expect(events[0].payload).toMatchObject({
    componentId: svc.id,
    componentName: `${marker} Manual`,
    previousStatus: 'operational',
    status: 'partial_outage',
    source: 'manual',
  })
  // The same status again is a no-op.
  await setServiceStatus(admin, svc.id, 'partial_outage')
  expect(await serviceEvents(svc.id)).toHaveLength(1)
  expect(await domainEvents(svc.id)).toHaveLength(1)
})

test(
  'STA-A-11 delete a service while an incident uses it',
  { tag: '@core' },
  async ({ marker }) => {
    const a = await createService(admin, `${marker} A`)
    const b = await createService(admin, `${marker} B`)
    const inc = await createIncident(admin, {
      title: marker,
      services: [
        [a.id, 'major_outage'],
        [b.id, 'major_outage'],
      ],
    })
    await must(admin, 'deleteStatusComponentFn', { id: a.id })
    expect((await serviceRow(a.id)).deleted_at).not.toBeNull()

    const list = await must<{
      ungrouped: { id: string }[]
      groups: { components: { id: string }[] }[]
    }>(admin, 'listStatusComponentsAdminFn', undefined, { method: 'GET' })
    const listed = [...list.ungrouped, ...list.groups.flatMap((g) => g.components)].map((c) => c.id)
    expect(listed).not.toContain(a.id)
    expect(listed).toContain(b.id)
    expect(publicServiceIds(await publicSnapshot(admin))).not.toContain(a.id)
    const editor = await getIncidentAdmin(admin, inc.id)
    expect(editor!.affectedComponents.map((c: { componentId: string }) => c.componentId)).toEqual([
      b.id,
    ])

    await postUpdate(admin, inc.id, 'resolved', 'fixed')
    expect((await serviceRow(b.id)).status).toBe('operational')
    const again = await callServerFn(admin, 'deleteStatusComponentFn', { id: a.id })
    expect(again.code).toBe('STATUS_COMPONENT_NOT_FOUND')
  }
)

test('STA-A-12 reorder services and groups', { tag: '@nightly' }, async ({ marker }) => {
  const one = await createService(admin, `${marker} One`)
  const two = await createService(admin, `${marker} Two`)
  await must(admin, 'reorderStatusComponentsFn', { ids: [two.id, one.id] })
  expect((await serviceRow(two.id)).position).toBeLessThan((await serviceRow(one.id)).position)
  const order = (await publicSnapshot(admin)).ungroupedComponents.map((c) => c.id)
  expect(order.indexOf(two.id)).toBeLessThan(order.indexOf(one.id))

  const g1 = await must<{ id: string }>(admin, 'createStatusGroupFn', { name: `${marker} G1` })
  const g2 = await must<{ id: string }>(admin, 'createStatusGroupFn', { name: `${marker} G2` })
  await must(admin, 'reorderStatusGroupsFn', { ids: [g2.id, g1.id] })
  const [p1] =
    await supportDb()`SELECT position FROM status_component_groups WHERE id = ${toUuid(g1.id as never)}`
  const [p2] =
    await supportDb()`SELECT position FROM status_component_groups WHERE id = ${toUuid(g2.id as never)}`
  expect(Number(p2.position)).toBeLessThan(Number(p1.position))

  expect((await callServerFn(admin, 'reorderStatusComponentsFn', { ids: [] })).ok).toBe(false)
  expect((await callServerFn(admin, 'reorderStatusGroupsFn', { ids: [] })).ok).toBe(false)
})

test(
  'STA-A-13 groups: create, rename, collapse',
  { tag: '@nightly' },
  async ({ asPerson, marker }) => {
    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=components')
    await ui.getByRole('button', { name: 'New group' }).click()
    const dialog = ui.getByRole('dialog', { name: 'New group' })
    await dialog.getByLabel('Name').fill(`${marker} Infra`)
    await dialog.getByRole('button', { name: 'Create group' }).click()
    await expect(dialog).toBeHidden()
    const [group] = await pollFor('the group', async () => {
      const rows = await supportDb()<
        { id: string }[]
      >`SELECT id FROM status_component_groups WHERE name = ${`${marker} Infra`}`
      return rows.length ? rows : null
    })
    const groupId = (
      await must<{ groups: { id: string; name: string }[] }>(
        admin,
        'listStatusComponentsAdminFn',
        undefined,
        { method: 'GET' }
      )
    ).groups.find((g) => g.name === `${marker} Infra`)!.id
    expect(toUuid(groupId as never)).toBe(group.id)

    // Empty: not rendered publicly.
    expect((await publicSnapshot(admin)).groups.map((g) => g.id)).not.toContain(groupId)
    await must(admin, 'updateStatusGroupFn', {
      id: groupId,
      name: `${marker} Platform`,
      collapsed: true,
    })
    const svc = await createService(admin, `${marker} In group`, { groupId })
    const pub = (await publicSnapshot(admin)).groups.find((g) => g.id === groupId)
    expect(pub).toMatchObject({ name: `${marker} Platform`, collapsed: true })
    expect(pub!.components.map((c) => c.id)).toEqual([svc.id])

    const missing = await callServerFn(admin, 'updateStatusGroupFn', {
      id: 'status_group_01m7v6aewge02vtv3kd36ggmcw',
      name: 'x',
    })
    expect(missing.code).toBe('STATUS_GROUP_NOT_FOUND')
  }
)

test(
  'STA-A-14 deleting a group leaves its services ungrouped',
  { tag: '@nightly' },
  async ({ marker }) => {
    const g = await must<{ id: string }>(admin, 'createStatusGroupFn', { name: `${marker} Doomed` })
    const svc = await createService(admin, `${marker} Orphan`, { groupId: g.id })
    await must(admin, 'deleteStatusGroupFn', { id: g.id })
    expect(
      await supportDb()`SELECT 1 FROM status_component_groups WHERE id = ${toUuid(g.id as never)}`
    ).toHaveLength(0)
    expect((await serviceRow(svc.id)).group_id).toBeNull()
    expect((await publicSnapshot(admin)).ungroupedComponents.map((c) => c.id)).toContain(svc.id)
    const again = await callServerFn(admin, 'deleteStatusGroupFn', { id: g.id })
    expect(again.code).toBe('STATUS_GROUP_NOT_FOUND')
  }
)
