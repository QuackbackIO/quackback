/**
 * Settings > Changelog: who may open it, the Visibility and Email cards, and
 * labels (create, edit, delete, validation, segment gates).
 *
 * Journeys: CHG-A-43 (@isolated), CHG-A-46, CHG-A-47 (@isolated), CHG-A-48
 * (@isolated), CHG-A-49, CHG-A-50, CHG-A-51, CHG-A-52 (quarantined),
 * CHG-A-53.
 *
 * Workspace-wide switches (audience, emails, auto-subscribe, the product
 * flag) run only in the isolated job; labels are the test's own.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { withSettings } from '../../support/isolated-settings'
import { callServerFn, personApi } from '../../support/server-fns'
import { mintCustomer, portalContext } from '../../support/widget-portal'
import { waitForHydration } from '../../utils/helpers'
import { createEntry, createLabel, retireChangelog, segmentWith } from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

async function changelogSettings(): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT metadata FROM settings LIMIT 1`
  const meta = JSON.parse(String(row.metadata ?? '{}')) as Record<string, unknown>
  return (meta.changelogSettings ?? {}) as Record<string, unknown>
}

async function labelRow(name: string) {
  const [row] =
    await supportDb()`SELECT id, name, color, segment_ids FROM changelog_categories WHERE name = ${name}`
  return row ?? null
}

test(
  'CHG-A-46 the admin opens Settings > Changelog; a role without changelog.manage cannot',
  { tag: '@core' },
  async ({ asPerson, playwright }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/changelog')
    await expect(admin.getByText('Who can see the changelog.')).toBeVisible()
    await expect(admin.getByText('Send changelog emails')).toBeVisible()
    await expect(admin.getByText('Auto-subscribe users')).toBeVisible()

    const contributor = await asPerson('contributor')
    await contributor.goto('/admin/settings/changelog')
    await expect(contributor.getByText('Who can see the changelog.')).toHaveCount(0)
    const api = await personApi(playwright, 'contributor')
    const read = await callServerFn(api, 'fetchChangelogSettingsFn', undefined, { method: 'GET' })
    expect(read.ok).toBe(false)
    await api.dispose()
  }
)

test(
  'CHG-A-47 the Visibility card switches the audience between Everyone and Signed-in users',
  { tag: ['@core', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    await withSettings({ metadata: { 'changelogSettings.audience': 'public' } }, async () => {
      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/changelog')
      const signedIn = admin.getByText('Signed-in users', { exact: true })
      await waitForHydration(signedIn)
      await signedIn.click()
      await expect.poll(async () => (await changelogSettings()).audience).toBe('authenticated')
      await admin.getByText('Everyone', { exact: true }).click()
      await expect.poll(async () => (await changelogSettings()).audience).toBe('public')
    })
  }
)

test(
  'CHG-A-48 the Email card turns changelog emails and auto-subscribe off and on',
  { tag: ['@core', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    await withSettings(
      {
        metadata: {
          'changelogSettings.emailsDisabled': false,
          'changelogSettings.autoSubscribe': true,
        },
      },
      async () => {
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/changelog')
        const send = admin.getByRole('switch', { name: 'Send changelog emails' })
        const auto = admin.getByRole('switch', { name: 'Auto-subscribe users' })
        await waitForHydration(send)
        await expect(send).toBeChecked()
        await send.click()
        await expect(send).not.toBeChecked()
        await expect.poll(async () => (await changelogSettings()).emailsDisabled).toBe(true)
        // The switches are disabled while a save is in flight.
        await expect(auto).toBeEnabled()
        await auto.click()
        await expect(auto).not.toBeChecked()
        await expect.poll(async () => (await changelogSettings()).autoSubscribe).toBe(false)
        await admin.reload()
        await expect(admin.getByRole('switch', { name: 'Send changelog emails' })).not.toBeChecked()
        await expect(admin.getByRole('switch', { name: 'Auto-subscribe users' })).not.toBeChecked()
        await admin.getByRole('switch', { name: 'Send changelog emails' }).click()
        await expect.poll(async () => (await changelogSettings()).emailsDisabled).toBe(false)
      }
    )
  }
)

test(
  'CHG-A-49 labels: create, and delete with its warning',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/changelog')
    const name = `${marker.slice(-28)} new`
    const add = admin.getByRole('button', { name: /new label/i })
    await waitForHydration(add)
    await add.click()
    const dialog = admin.getByRole('dialog', { name: 'Create label' })
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Create label' }).click()
    await expect(dialog).toBeHidden()
    await expect(admin.getByText(name, { exact: true })).toBeVisible()
    const created = await labelRow(name)
    expect(created).not.toBeNull()

    await admin.getByRole('button', { name: `Actions for ${name}` }).click()
    await admin.getByRole('menuitem', { name: 'Delete' }).click()
    const confirm = admin.getByRole('alertdialog')
    await expect(confirm).toContainText(
      `Delete "${name}"? This removes it from every changelog entry.`
    )
    await confirm.getByRole('button', { name: /delete/i }).click()
    await expect(admin.getByText(name, { exact: true })).toHaveCount(0)
    expect(await labelRow(name)).toBeNull()
  }
)

test(
  'CHG-A-50 label names must be unique (any case) and at most 50 characters',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const name = `${marker.slice(-28)} dup`
    await createLabel(admin, name)
    const dup = await callServerFn(admin, 'createChangelogCategoryFn', { name: name.toUpperCase() })
    expect(dup.code).toBe('DUPLICATE_NAME')
    const long = await callServerFn(admin, 'createChangelogCategoryFn', { name: 'x'.repeat(51) })
    expect(long.ok).toBe(false)
    const [{ n }] =
      await supportDb()`SELECT count(*)::int AS n FROM changelog_categories WHERE lower(name) = lower(${name})`
    expect(n).toBe(1)
    await admin.dispose()
  }
)

test(
  'CHG-A-49 renaming a label keeps its id, and a rename onto a taken name is refused',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const name = `${marker.slice(-28)} old`
    const renamed = `${marker.slice(-28)} newer`
    const label = await createLabel(api, name)
    const other = await createLabel(api, `${marker.slice(-28)} other`)
    const dup = await callServerFn(api, 'updateChangelogCategoryFn', { id: other.id, name })
    expect(dup.code).toBe('DUPLICATE_NAME')
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/changelog')
    const actions = admin.getByRole('button', { name: `Actions for ${name}` })
    await waitForHydration(actions)
    await actions.click()
    await admin.getByRole('menuitem', { name: 'Edit' }).click()
    const edit = admin.getByRole('dialog', { name: 'Edit label' })
    await edit.getByLabel('Name').fill(renamed)
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()
    await expect(admin.getByText(renamed, { exact: true })).toBeVisible()
    expect((await labelRow(renamed))?.id).toBe(toUuid(label.id as `changelog_category_${string}`))
  }
)

test(
  'CHG-A-51 a segment-gated label hides its entries from outsiders until the label is deleted',
  { tag: '@core' },
  async ({ browser, playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const label = await createLabel(admin, `${marker.slice(-28)} gate`, [segment])
    expect((await labelRow(label.name))?.segment_ids).toEqual([segment])
    const entry = await createEntry(admin, {
      title: `${marker} gated`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
    })
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const read = () =>
      callServerFn(anonymous, 'getPublicChangelogFn', { id: entry.id }, { method: 'GET' })
    expect((await read()).ok).toBe(false)
    const memberCtx = await portalContext(browser, member)
    expect(
      (
        await callServerFn(
          memberCtx.request,
          'getPublicChangelogFn',
          { id: entry.id },
          { method: 'GET' }
        )
      ).ok
    ).toBe(true)
    await memberCtx.close()

    expect((await callServerFn(admin, 'deleteChangelogCategoryFn', { id: label.id })).ok).toBe(true)
    const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM changelog_entry_categories
      WHERE category_id = ${toUuid(label.id as `changelog_category_${string}`)}`
    expect(n).toBe(0)
    expect((await read()).ok).toBe(true)
    await anonymous.dispose()
    await admin.dispose()
  }
)

test(
  'CHG-A-52 a signed-out caller cannot read gated labels or their segment ids',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'functions/changelog-categories.ts listChangelogCategoriesFn is unauthenticated and returns every label with its segmentIds (see QUARANTINE.md)',
    },
  },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const segment = await segmentWith(marker, [])
    const label = await createLabel(admin, `${marker.slice(-28)} secret`, [segment])
    const anonymous = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const res = await callServerFn<Array<{ id: string; segmentIds?: string[] }>>(
      anonymous,
      'listChangelogCategoriesFn',
      undefined,
      { method: 'GET' }
    )
    const rows = res.ok ? res.data : []
    expect(rows.some((r) => r.id === label.id)).toBe(false)
    expect(JSON.stringify(rows)).not.toContain(segment)
    await anonymous.dispose()
    await admin.dispose()
  }
)

test(
  'CHG-A-53 without changelog.manage, settings and label writes are refused and change nothing',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const label = await createLabel(admin, `${marker.slice(-28)} keep`)
    await admin.dispose()
    const before = await changelogSettings()
    const contributor = await personApi(playwright, 'contributor')
    for (const [fn, data] of [
      ['updateChangelogSettingsFn', { autoSubscribe: false }],
      ['createChangelogCategoryFn', { name: `${marker.slice(-28)} nope` }],
      ['updateChangelogCategoryFn', { id: label.id, name: `${marker.slice(-28)} renamed` }],
      ['deleteChangelogCategoryFn', { id: label.id }],
      ['reorderChangelogCategoriesFn', { ids: [label.id] }],
    ] as const) {
      const res = await callServerFn(contributor, fn, data)
      expect(res.ok, fn).toBe(false)
    }
    await contributor.dispose()
    expect(await changelogSettings()).toEqual(before)
    expect((await labelRow(label.name))?.id).toBeDefined()
    expect(await labelRow(`${marker.slice(-28)} nope`)).toBeNull()
  }
)

test(
  'CHG-A-43 with the Changelog product off, the admin changelog and its settings page send the admin away',
  { tag: ['@nightly', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await asPerson('admin')
    await withSettings({ feature_flags: { changelog: true } }, async () => {
      await admin.goto('/admin/changelog')
      await expect(admin).toHaveURL(/\/admin\/changelog/)
    })
    await withSettings({ feature_flags: { changelog: false } }, async () => {
      await admin.goto('/admin/changelog')
      await expect(admin).not.toHaveURL(/\/admin\/changelog/)
      await admin.goto('/admin/settings/changelog')
      await expect(admin).not.toHaveURL(/\/admin\/settings\/changelog/)
    })
  }
)
