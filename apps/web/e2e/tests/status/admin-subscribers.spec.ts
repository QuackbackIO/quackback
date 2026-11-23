/**
 * Status admin: the Subscribers view (list, add, import, remove, export).
 *
 * Journeys: STA-A-50, STA-A-51, STA-A-52, STA-A-53, STA-A-54, STA-A-55.
 *
 * Subscribers are page-wide, so each one would receive every other test's
 * publish email: every subscriber made here is removed again at the end.
 * People are minted per test (one subscription row per person).
 */
import { writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { mintCustomer, type MintedCustomer } from '../../support/widget-portal'
import { pollFor } from '../../support/db'
import { must, openAdmin, searchList, subscriptionRow } from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext
let made: MintedCustomer[] = []

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
  made = []
})
test.afterEach(async () => {
  for (const p of made) {
    await callServerFn(admin, 'removeStatusSubscriberFn', { principalId: p.principalId })
  }
  await admin.dispose()
})

async function person(marker: string, label: string): Promise<MintedCustomer> {
  const p = await mintCustomer({
    email: `${marker}-${label}@customers.example`,
    name: `${label} ${marker.slice(-8)}`,
  })
  made.push(p)
  return p
}

interface SubListItem {
  principalId: string
  email: string | null
  source: string
  scope: string
  unsubscribedAt: string | null
}

async function listAll(search: string, limit = 30): Promise<SubListItem[]> {
  const out: SubListItem[] = []
  let cursor: string | undefined
  for (let i = 0; i < 20; i++) {
    const page = await must<{ items: SubListItem[]; nextCursor: string | null; hasMore: boolean }>(
      admin,
      'listStatusSubscriptionsAdminFn',
      { search, limit, ...(cursor ? { cursor } : {}) },
      { method: 'GET' }
    )
    out.push(...page.items)
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}

test(
  'STA-A-50 the Subscribers view lists and searches subscribers',
  { tag: '@nightly' },
  async ({ asPerson, marker }) => {
    const ann = await person(marker, 'ann')
    const bob = await person(marker, 'bob')
    await must(admin, 'addStatusSubscriberFn', { email: ann.email })
    await must(admin, 'importStatusSubscribersFn', { emails: [bob.email] })
    await must(admin, 'removeStatusSubscriberFn', { principalId: bob.principalId })

    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=subscribers')
    for (const label of ['Total', 'Active', 'Unsubscribed']) {
      await expect(ui.getByText(label, { exact: true }).first()).toBeVisible()
    }
    const annRow = ui.locator('div.group', { hasText: ann.email })
    await searchList(ui, marker, annRow, 'Search subscribers…')
    await expect(annRow.getByText('Added by admin')).toBeVisible()
    const bobRow = ui.locator('div.group', { hasText: bob.email })
    await expect(bobRow.getByText('CSV import')).toBeVisible()
    await expect(bobRow.getByText(/Unsubscribed/)).toBeVisible()
    // Newest first.
    await expect(ui.locator('div.group', { hasText: marker })).toHaveCount(2)
    await expect(ui.locator('div.group', { hasText: marker }).first()).toContainText(bob.email)
    // Display-name search.
    await searchList(ui, `ann ${marker.slice(-8)}`, annRow, 'Search subscribers…')
    await expect(bobRow).toHaveCount(0)
    await searchList(
      ui,
      `${marker}-nobody`,
      ui.getByText('No subscribers match your search'),
      'Search subscribers…'
    )
  }
)

test('STA-A-51 add a subscriber by email', { tag: '@core' }, async ({ marker }) => {
  const p = await person(marker, 'Add')
  const res = await must<{ subscribed: boolean }>(admin, 'addStatusSubscriberFn', {
    email: p.email.toUpperCase(),
  })
  expect(res.subscribed).toBe(true)
  expect(await subscriptionRow(p.principalUuid)).toMatchObject({
    scope: 'page',
    component_ids: [],
    source: 'admin',
    unsubscribed_at: null,
  })

  const unknown = await callServerFn(admin, 'addStatusSubscriberFn', {
    email: `${marker}-nobody@customers.example`,
  })
  expect(unknown.code).toBe('STATUS_SUBSCRIBER_NOT_FOUND')

  // Someone who unsubscribed stays unsubscribed.
  await must(admin, 'removeStatusSubscriberFn', { principalId: p.principalId })
  const optedOut = await must<{ subscribed: boolean }>(admin, 'addStatusSubscriberFn', {
    email: p.email,
  })
  expect(optedOut.subscribed).toBe(false)
  expect((await subscriptionRow(p.principalUuid))?.unsubscribed_at).not.toBeNull()
})

test(
  'STA-A-52 import subscribers from a CSV file',
  { tag: '@core' },
  async ({ asPerson, marker }, testInfo) => {
    const a = await person(marker, 'csva')
    const b = await person(marker, 'csvb')
    const out = await person(marker, 'csvout')
    await must(admin, 'addStatusSubscriberFn', { email: out.email })
    await must(admin, 'removeStatusSubscriberFn', { principalId: out.principalId })
    const file = testInfo.outputPath('subscribers.csv')
    writeFileSync(
      file,
      [
        'Name,Email',
        `A,${a.email}`,
        `A again,${a.email.toUpperCase()}`,
        `B,${b.email}`,
        `X,${marker}-nobody@customers.example`,
        `O,${out.email}`,
      ].join('\n')
    )

    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status?view=subscribers')
    await ui.getByRole('button', { name: 'New subscriber' }).click()
    const dialog = ui.getByRole('dialog', { name: 'New subscriber' })
    await dialog.getByRole('tab', { name: 'CSV import' }).click()
    await dialog.locator('input[type="file"]').setInputFiles(file)
    await expect(dialog.getByText('(5 emails found)')).toBeVisible()
    const submit = dialog.getByRole('button', { name: 'Subscribe 5 emails' })
    await expect(submit).toBeDisabled()
    await dialog.getByRole('checkbox').click()
    await submit.click()
    await expect(
      ui.getByText('Imported 2. Skipped 1 without a matching account. Skipped 1 who unsubscribed.')
    ).toBeVisible()
    for (const p of [a, b]) {
      expect(await subscriptionRow(p.principalUuid)).toMatchObject({
        scope: 'page',
        source: 'csv_import',
        unsubscribed_at: null,
      })
    }
    expect((await subscriptionRow(out.principalUuid))?.unsubscribed_at).not.toBeNull()

    // A file with no emails.
    const empty = testInfo.outputPath('empty.csv')
    writeFileSync(empty, 'Email\n')
    // The dialog closed after the import; open it again.
    await ui.getByRole('button', { name: 'New subscriber' }).click()
    await dialog.getByRole('tab', { name: 'CSV import' }).click()
    await dialog.locator('input[type="file"]').setInputFiles(empty)
    await expect(
      dialog.getByText('No emails found. Make sure the file has an "Email" column.')
    ).toBeVisible()
    // More than 5000 is refused.
    const tooMany = await callServerFn(admin, 'importStatusSubscribersFn', {
      emails: Array.from({ length: 5001 }, (_, i) => `${marker}-${i}@customers.example`),
    })
    expect(tooMany.ok).toBe(false)
  }
)

test(
  'STA-A-53 every row of a large import is listed across pages',
  {
    tag: '@nightly',
  },
  async ({ marker }) => {
    const people: MintedCustomer[] = []
    for (let i = 0; i < 35; i++) people.push(await person(marker, `bulk${i}`))
    const res = await must<{ imported: number }>(admin, 'importStatusSubscribersFn', {
      emails: people.map((p) => p.email),
    })
    expect(res.imported).toBe(35)
    const listed = await listAll(marker)
    const exported = await must<{ email: string | null }[]>(
      admin,
      'exportStatusSubscribersAdminFn',
      undefined,
      { method: 'GET' }
    )
    expect(exported.filter((r) => r.email?.startsWith(marker))).toHaveLength(35)
    expect(new Set(listed.map((r) => r.principalId)).size).toBe(35)
  }
)

test('STA-A-54 remove a subscriber', { tag: '@nightly' }, async ({ asPerson, marker }) => {
  const p = await person(marker, 'rm')
  await must(admin, 'addStatusSubscriberFn', { email: p.email })
  const ui = await asPerson('admin')
  await openAdmin(ui, '/admin/status?view=subscribers')
  const row = ui.locator('div.group', { hasText: p.email })
  await searchList(ui, marker, row, 'Search subscribers…')
  await row.hover()
  await row.getByRole('button', { name: `Remove ${p.name}` }).click()
  const confirm = ui.getByRole('alertdialog').or(ui.getByRole('dialog'))
  await expect(confirm.getByText('Remove subscriber?')).toBeVisible()
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(ui.getByText(`Removed ${p.name}.`)).toBeVisible()
  const first = await pollFor(
    'the opt-out',
    async () => (await subscriptionRow(p.principalUuid))?.unsubscribed_at ?? null
  )

  const again = await must<{ removed: boolean }>(admin, 'removeStatusSubscriberFn', {
    principalId: p.principalId,
  })
  expect(again.removed).toBe(false)
  expect((await subscriptionRow(p.principalUuid))?.unsubscribed_at).toEqual(first)
})

test('STA-A-55 export subscribers to CSV', { tag: '@nightly' }, async ({ asPerson, marker }) => {
  const live = await person(marker, 'exlive')
  const gone = await person(marker, 'exgone')
  await must(admin, 'addStatusSubscriberFn', { email: live.email })
  await must(admin, 'addStatusSubscriberFn', { email: gone.email })
  await must(admin, 'removeStatusSubscriberFn', { principalId: gone.principalId })

  const ui = await asPerson('admin')
  await openAdmin(ui, '/admin/status?view=subscribers')
  const download = ui.waitForEvent('download')
  await ui.getByRole('button', { name: 'Export CSV' }).click()
  const file = await (await download).path()
  const csv = await readFile(file, 'utf8')
  const lines = csv.split(/\r?\n/)
  const liveLine = lines.find((l) => l.includes(live.email))
  const goneLine = lines.find((l) => l.includes(gone.email))
  expect(liveLine).toBeTruthy()
  expect(goneLine).toBeTruthy()
  // Newest first: the later subscription comes first.
  expect(lines.indexOf(goneLine!)).toBeLessThan(lines.indexOf(liveLine!))
})
