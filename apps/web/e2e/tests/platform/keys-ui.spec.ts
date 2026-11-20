/**
 * API keys in the browser: a teammate's own personal keys (/settings/api-keys)
 * and an admin's workspace keys (Settings > Developers). Journeys API-K-01,
 * API-K-04 (`@isolated`: the personal key policy is workspace-wide) and
 * API-K-10.
 *
 * Each key value is read from the reveal dialog, the only place it is shown.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { apiFor, createKey, eventsFor, expectJson } from '../../support/api-client'
import { callServerFn } from '../../support/server-fns'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import {
  expectForbidden,
  keyApi,
  makeBoard,
  makePost,
  sessionApi,
} from '../../product/api-rest-keys'

test.describe.configure({ timeout: 60_000 })

const ALL_SCOPES = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
  'read:settings',
  'write:settings',
]
const DAY = 24 * 60 * 60 * 1000

/** The key value shown once in the open reveal dialog. */
async function revealedKey(page: Page): Promise<string> {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('API key created')).toBeVisible({ timeout: 15_000 })
  const code = dialog.locator('code').filter({ hasText: /^qb_[0-9a-f]{48}$/ })
  await expect(code).toHaveCount(1)
  return (await code.textContent())!.trim()
}

/** The api_keys row (and its principal) by key name. */
async function keyByName(name: string) {
  const [row] = await supportDb()`SELECT k.id, k.kind, k.scopes, k.expires_at, k.key_prefix,
      k.created_by_id, p.id AS principal_id, p.role, p.display_name
    FROM api_keys k JOIN principal p ON p.id = k.principal_id WHERE k.name = ${name}`
  return row
}

test(
  'API-K-01 a teammate creates a personal key with the defaults',
  { tag: '@core' },
  async ({ browser, playwright, baseURL, marker, newTeammate }) => {
    const mate = await newTeammate({ roleKey: 'contributor' })
    const page = await mate.newPage(browser)
    await page.goto('/settings/api-keys')
    const dialog = page.getByRole('dialog')
    // The button works once the page has hydrated.
    await expect(async () => {
      await page.getByRole('button', { name: 'New key' }).click()
      await expect(dialog.getByLabel('Name')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await dialog.getByLabel('Name').fill(marker)
    await expect(dialog.getByRole('radio', { name: '90 days' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    const before = Date.now()
    await dialog.getByRole('button', { name: 'Create key' }).click()
    await expect(
      page.getByRole('dialog').getByText(`Your API key ${marker} is ready.`)
    ).toBeVisible({
      timeout: 15_000,
    })
    const value = await revealedKey(page)
    await page.getByRole('button', { name: "I've saved my key" }).click()

    const row = await keyByName(marker)
    expect(row).toMatchObject({
      kind: 'personal',
      created_by_id: toUuid(mate.principalId as `principal_${string}`),
      key_prefix: value.slice(0, 12),
      role: 'member',
      display_name: marker,
    })
    expect(JSON.parse(row.scopes as string)).toEqual(ALL_SCOPES)
    const expires = new Date(row.expires_at as string).getTime()
    expect(expires).toBeGreaterThan(before + 90 * DAY - 60_000)
    expect(expires).toBeLessThan(Date.now() + 90 * DAY + 60_000)
    const [created] = await eventsFor(fromUuid('api_key', row.id as string), ['apikey.created'])
    expect(created.payload).toMatchObject({ kind: 'personal', scopes: ALL_SCOPES })

    const listed = page.locator('[data-slot="settings-list"] > *').filter({ hasText: marker })
    await expect(listed).toHaveCount(1)
    await expect(listed).toContainText(value.slice(0, 12))
    await expect(listed).toContainText('Never used')
    await expect(listed).toContainText('Expires')

    const api = await apiFor(playwright, baseURL, value)
    await expectJson(await api.get('/api/v1/boards'), 200)
    await api.dispose()
  }
)

test(
  'API-K-04 with the personal key policy off, new keys stop and existing ones keep working',
  { tag: ['@core', '@isolated'] },
  async ({ browser, playwright, baseURL, marker, newTeammate }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const mate = await newTeammate({ roleKey: 'contributor' })
    const existing = createKey({ creatorEmail: mate.email, scopes: ['read:feedback'] })
    await withSettings({ developer_config: { personalApiKeysEnabled: false } }, async () => {
      const page = await mate.newPage(browser)
      await page.goto('/settings/api-keys')
      await expect(page.getByText('Your admin has turned off new personal keys.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'New key' })).toBeDisabled()

      const session = await sessionApi(playwright, mate.userId)
      const res = await callServerFn<Record<string, unknown>>(session, 'createMyApiKeyFn', {
        name: marker,
        scopes: ['read:feedback'],
        expiry: '30d',
      })
      expect(res.data).toEqual({
        ok: false,
        code: 'POLICY_OFF',
        message: 'Your admin has turned off new personal keys.',
      })
      expect(await keyByName(marker)).toBeUndefined()

      const api = await apiFor(playwright, baseURL, existing.key)
      await expectJson(await api.get('/api/v1/boards'), 200)
      const renamed = await callServerFn<{ ok: boolean }>(session, 'renameMyApiKeyFn', {
        id: existing.id,
        name: `Renamed ${marker}`,
      })
      expect(renamed.data.ok).toBe(true)
      await api.dispose()
      await session.dispose()
    })
  }
)

test(
  'API-K-10 an admin creates a Contributor workspace key with Feedback read and write only',
  { tag: '@smoke' },
  async ({ asPerson, playwright, baseURL, people, marker }) => {
    const page = await asPerson('admin')
    await page.goto('/admin/settings/developers/workspace-keys/new')
    // Inputs keep their value once the page has hydrated.
    await expect(async () => {
      await page.getByRole('radio', { name: 'Contributor' }).click()
      await page.getByLabel('Name').fill(marker)
      await expect(page.getByLabel('Name')).toHaveValue(marker, { timeout: 1_000 })
      await expect(page.getByRole('radio', { name: 'Contributor' })).toBeChecked({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    for (const chip of [
      'Changelog: Write',
      'Help Center: Read and write',
      'Conversations: Read and write',
      'Settings: Read and write',
    ]) {
      await page.getByRole('button', { name: chip }).click()
    }
    await expect(page.getByRole('button', { name: 'Feedback: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('button', { name: 'Create key' }).click()
    const value = await revealedKey(page)

    const row = await keyByName(marker)
    expect(row).toMatchObject({ kind: 'workspace', expires_at: null, role: 'member' })
    expect(JSON.parse(row.scopes as string)).toEqual(['read:feedback', 'write:feedback'])
    const [grant] = await supportDb()`SELECT r.key FROM principal_role_assignments a
      JOIN roles r ON r.id = a.role_id WHERE a.principal_id = ${row.principal_id as string}`
    expect(grant.key).toBe('contributor')

    const owner = await keyApi(playwright, baseURL, {
      creatorEmail: people.people.admin.email,
      kind: 'workspace',
      roleKey: 'owner',
    })
    const board = await makeBoard(owner.api, marker)
    const api = await apiFor(playwright, baseURL, value)
    await makePost(api, board, `Post ${marker}`)
    await expectForbidden(
      await api.post('/api/v1/boards', { data: { name: `Nope ${marker}` } }),
      "Requires the 'board.manage' permission"
    )
    await expectJson(await api.get('/api/v1/help-center/articles'), 200)
    await api.dispose()
    await owner.api.dispose()
  }
)
