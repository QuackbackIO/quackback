/**
 * Status admin: incident templates.
 *
 * Journeys: STA-A-47, STA-A-48, STA-A-49.
 *
 * The template list and the composers' template pickers are workspace-wide;
 * each test picks its own template by marker.
 */
import type { APIRequestContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor, supportDb } from '../../support/db'
import {
  createIncident,
  createService,
  incidentRow,
  incidentUpdates,
  messageOf,
  must,
  openAdmin,
  searchList,
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

interface Template {
  id: string
  name: string
  title: string
  body: string
  impact: string
  componentIds: string[]
  usageCount: number
}

async function templateNamed(name: string): Promise<Template | null> {
  const list = await must<Template[]>(admin, 'listStatusIncidentTemplatesFn', undefined, {
    method: 'GET',
  })
  return list.find((t) => t.name === name) ?? null
}

test('STA-A-47 manage incident templates', { tag: '@nightly' }, async ({ asPerson, marker }) => {
  const svc = await createService(admin, `${marker} Tmpl svc`)
  const ui = await asPerson('admin')
  await openAdmin(ui, '/admin/status?view=templates')
  await ui.getByRole('button', { name: 'New template' }).first().click()
  const dialog = ui.getByRole('dialog', { name: 'New template' })
  await dialog.getByLabel('Template name').fill(`${marker} API down`)
  await dialog.getByLabel('Incident title').fill(`${marker} API errors`)
  await dialog.getByLabel('Body').fill('We are investigating API errors.')
  await dialog.getByRole('combobox').click()
  await ui.getByRole('option', { name: 'Major impact' }).click()
  await dialog.getByRole('checkbox', { name: svc.name }).check()
  await dialog.getByRole('button', { name: 'Create template' }).click()
  await expect(dialog).toBeHidden()

  const created = await pollFor('the template', () => templateNamed(`${marker} API down`))
  expect(created).toMatchObject({
    title: `${marker} API errors`,
    body: 'We are investigating API errors.',
    impact: 'major',
    componentIds: [svc.id],
    usageCount: 0,
  })
  const row = ui.locator('div.group', { hasText: `${marker} API down` })
  await searchList(ui, marker, row, 'Search templates…')
  await expect(row.getByText('Major impact')).toBeVisible()
  await expect(row.getByText('Unused')).toBeVisible()

  // Edit.
  await row.hover()
  await row.getByRole('button').first().click()
  const edit = ui.getByRole('dialog', { name: 'Edit template' })
  await edit.getByLabel('Incident title').fill(`${marker} API errors (edited)`)
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(edit).toBeHidden()
  await pollFor('the edit', async () =>
    (await templateNamed(`${marker} API down`))?.title === `${marker} API errors (edited)`
      ? true
      : null
  )

  // A use, then delete: the update keeps its row with template_id nulled.
  const inc = await createIncident(admin, {
    title: marker,
    services: [[svc.id, 'degraded_performance']],
    templateId: created.id,
  })
  expect((await incidentUpdates(inc.id))[0].template_id).toBe(toUuid(created.id as never))
  await openAdmin(ui, '/admin/status?view=templates')
  await searchList(ui, marker, row, 'Search templates…')
  await expect(row.getByText('Used once')).toBeVisible()
  await row.hover()
  await row.getByRole('button').nth(1).click()
  const confirm = ui.getByRole('alertdialog').or(ui.getByRole('dialog'))
  await expect(confirm.getByText('Delete template?')).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await pollFor('the delete', async () =>
    (await templateNamed(`${marker} API down`)) === null ? true : null
  )
  const updates = await incidentUpdates(inc.id)
  expect(updates).toHaveLength(1)
  expect(updates[0].template_id).toBeNull()

  const missing = await callServerFn(admin, 'updateStatusIncidentTemplateFn', {
    id: created.id,
    name: 'x',
  })
  expect(missing.code).toBe('STATUS_TEMPLATE_NOT_FOUND')
  const missingDelete = await callServerFn(admin, 'deleteStatusIncidentTemplateFn', {
    id: created.id,
  })
  expect(missingDelete.code).toBe('STATUS_TEMPLATE_NOT_FOUND')
})

test(
  'STA-A-48 apply a template in a composer and count its use',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const svc = await createService(admin, `${marker} Tmpl use`)
    const tmpl = await must<Template>(admin, 'createStatusIncidentTemplateFn', {
      name: `${marker} template`,
      title: `${marker} from template`,
      body: 'Templated body',
      impact: 'major',
      componentIds: [svc.id],
    })
    const ui = await asPerson('contributor')
    await openAdmin(ui, '/admin/status?view=open')
    await ui.getByRole('button', { name: 'Report incident' }).first().click()
    const dialog = ui.getByRole('dialog', { name: 'Report an incident' })
    await dialog.getByRole('button', { name: 'Start from template' }).click()
    await ui.getByRole('button', { name: new RegExp(`^${marker} template`) }).click()
    await expect(dialog.getByLabel('Title')).toHaveValue(`${marker} from template`)
    await expect(dialog.getByLabel("What's happening?")).toHaveValue('Templated body')
    await expect(dialog.getByText(/pinned by the applied template/)).toBeVisible()
    await dialog.getByRole('checkbox', { name: /Email subscribers/ }).click()
    await dialog.getByRole('button', { name: 'Publish incident' }).click()
    await expect(ui).toHaveURL(/incident=status_incident_/)
    const id = new URL(ui.url()).searchParams.get('incident')!
    const row = await incidentRow(id)
    expect(row).toMatchObject({ impact: 'major', impact_override: true })
    expect(
      await supportDb()`SELECT 1 FROM status_incident_components WHERE incident_id = ${toUuid(id as never)} AND component_id = ${toUuid(svc.id as never)}`
    ).toHaveLength(1)

    // Insert the template into an update: appended after a blank line.
    const composer = ui.getByPlaceholder(
      "What's the latest? This appears on the public status page."
    )
    await composer.fill('Our own words')
    await ui.getByRole('button', { name: 'Insert template' }).click()
    await ui.getByRole('button', { name: new RegExp(`^${marker} template`) }).click()
    await expect(composer).toHaveValue('Our own words\n\nTemplated body')
    await ui.getByRole('button', { name: 'Post update' }).click()
    await pollFor('the update', async () =>
      (await incidentUpdates(id)).length === 2 ? true : null
    )
    const updates = await incidentUpdates(id)
    expect(updates.map((u) => u.template_id)).toEqual([
      toUuid(tmpl.id as never),
      toUuid(tmpl.id as never),
    ])
    expect((await templateNamed(`${marker} template`))?.usageCount).toBe(2)
  }
)

test(
  'STA-A-49 a blank template name is refused with the Name field named',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'createStatusIncidentTemplate validates the name with validateTitle (status.service.ts), so the refusal says "Title is required"; see QUARANTINE.md',
    },
  },
  async ({ marker }) => {
    const res = await callServerFn(admin, 'createStatusIncidentTemplateFn', {
      name: '   ',
      title: marker,
      body: 'x',
    })
    expect(res.code).toBe('VALIDATION_ERROR')
    expect(messageOf(res)).toMatch(/name is required/i)
  }
)
