/**
 * MCP settings, navigation and widget tools, the MCP server switch, and the
 * admin MCP page (/api/mcp, Settings > Developers > MCP).
 *
 * Journeys: API-M-01, API-M-85, API-M-86, API-M-87, API-M-88, API-M-89,
 * API-M-90, API-M-93, API-M-94.
 *
 * API-M-01, API-M-86 and API-M-94 change workspace-wide settings and run in
 * the isolated job only. API-M-87 previews its changes with dry_run, so it
 * writes nothing.
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { bustSettingsCache, withSettings } from '../../support/isolated-settings'
import {
  apiFor,
  fixture,
  mcpCall,
  mcpOAuthToken,
  mcpRpc,
  newTeammate,
  seedCustomer,
} from '../../support/api-client'
import {
  ALL_SCOPES,
  adminApi,
  expectToolError,
  keyApi,
  oauthApi,
  rawRpc,
  toolCallMsg,
  uuid,
  waitForAudit,
} from '../../product/mcp'

test.describe.configure({ timeout: 60_000 })

const permissionError = (perm: string) =>
  `Error: This operation requires the '${perm}' permission. Ask a workspace owner or an admin to grant it.`

test.describe('MCP server switch', () => {
  test(
    'API-M-01 the MCP server switched off refuses every caller before auth, and serves them again when on',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const key = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const callers = [
        await apiFor(playwright, baseURL, null),
        key.api,
        await apiFor(
          playwright,
          baseURL,
          mcpOAuthToken(people.people.admin.email, ['read:feedback'])
        ),
      ]
      const lastUsed = async () =>
        (await supportDb()`SELECT last_used_at FROM api_keys WHERE id = ${uuid(key.id)}`)[0]
          .last_used_at

      await withSettings({ developer_config: { mcpEnabled: false } }, async () => {
        const before = await lastUsed()
        for (const [i, api] of callers.entries()) {
          const res = await rawRpc(api, {
            jsonrpc: '2.0',
            id: `off-${i}`,
            method: 'tools/list',
            params: {},
          })
          expect(res.status, String(i)).toBe(403)
          expect(res.body).toEqual({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'MCP server is disabled. Enable it in Settings > Developers > MCP Server.',
            },
            id: `off-${i}`,
          })
        }
        expect(await lastUsed()).toEqual(before)
      })

      expect((await mcpRpc(callers[0], 'tools/list')).status()).toBe(401)
      expect((await mcpRpc(callers[1], 'tools/list')).status()).toBe(200)
      expect((await mcpRpc(callers[2], 'tools/list')).status()).toBe(200)
    }
  )

  test(
    'API-M-94 the MCP server switch in the admin page persists and the endpoint follows it',
    { tag: ['@nightly', '@isolated'] },
    async ({ asPerson, playwright, baseURL, people }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const key = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const page = await asPerson('admin')
      await page.goto('/admin/settings/developers?tab=mcp')
      const toggle = page.getByRole('switch', { name: 'MCP server' })
      await expect(toggle).toBeChecked()
      // A click before hydration is lost.
      await page.waitForLoadState('networkidle')
      try {
        await toggle.click()
        await expect(toggle).not.toBeChecked()
        await expect
          .poll(async () => (await mcpRpc(key.api, 'tools/list')).status(), { timeout: 10_000 })
          .toBe(403)
        await page.reload()
        await expect(page.getByRole('switch', { name: 'MCP server' })).not.toBeChecked()
        await page.getByRole('switch', { name: 'MCP server' }).click()
        await expect(page.getByRole('switch', { name: 'MCP server' })).toBeChecked()
        await expect
          .poll(async () => (await mcpRpc(key.api, 'tools/list')).status(), { timeout: 10_000 })
          .toBe(200)
      } finally {
        await supportDb()`
          UPDATE settings SET developer_config =
            (coalesce(nullif(developer_config, '')::jsonb, '{}'::jsonb) || '{"mcpEnabled": true}'::jsonb)::text`
        await bustSettingsCache()
      }
    }
  )
})

test.describe('MCP settings tools', () => {
  test(
    'API-M-85 get_settings lists the readable areas and reads one; an area needs its permission',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const list = await mcpCall(admin, 'get_settings', {})
      expect(list.isError, list.text).toBe(false)
      const areas = list.json.areas.map((a: { id?: string; area?: string }) => a.id ?? a.area)
      expect(areas).toEqual(expect.arrayContaining(['branding', 'portal', 'modules', 'changelog']))
      expect(list.json.note).toEqual(expect.any(String))

      const branding = await mcpCall(admin, 'get_settings', { area: 'branding' })
      expect(branding.json).toMatchObject({
        revision: expect.any(String),
        note: expect.any(String),
      })
      expect(branding.json).toHaveProperty('locked')
      expect(branding.json).toHaveProperty('gates')

      // OAuth, not a personal key: a member's key is capped at the Manager
      // preset, which holds no settings permission.
      const designer = newTeammate(`${marker} designer`, ['settings.branding', 'member.view'])
      const oauth = await oauthApi(playwright, baseURL, designer.email, ALL_SCOPES)
      expectToolError(
        await mcpCall(oauth, 'get_settings', { area: 'modules' }),
        permissionError('settings.manage')
      )
      const own = await mcpCall(oauth, 'get_settings', {})
      const ownAreas = own.json.areas.map((a: { id?: string; area?: string }) => a.id ?? a.area)
      expect(ownAreas).toContain('branding')
      expect(ownAreas).not.toContain('modules')
    }
  )

  test(
    'API-M-86 update_settings asks for the revision, previews, applies with a receipt and refuses a stale revision',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const key = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const [{ name: originalName }] = await supportDb()`SELECT name FROM settings LIMIT 1`
      const newName = `Acme ${marker}`.slice(0, 60)
      try {
        expectToolError(
          await mcpCall(key.api, 'update_settings', {
            area: 'portal',
            patch: { displayName: newName },
          }),
          'Error: Read the area with get_settings and pass its revision as expected_revision. (code: IF_MATCH_REQUIRED)'
        )

        const read = await mcpCall(key.api, 'get_settings', { area: 'portal' })
        const revision = read.json.revision as string
        const dry = await mcpCall(key.api, 'update_settings', {
          area: 'portal',
          patch: { displayName: newName },
          dry_run: true,
        })
        expect(dry.json).toMatchObject({
          status: 'dry_run',
          area: 'portal',
          changes: [expect.objectContaining({ after: newName })],
        })
        expect((await supportDb()`SELECT name FROM settings LIMIT 1`)[0].name).toBe(originalName)

        const applied = await mcpCall(key.api, 'update_settings', {
          area: 'portal',
          patch: { displayName: newName },
          expected_revision: revision,
        })
        expect(applied.isError, applied.text).toBe(false)
        expect(applied.json).toMatchObject({
          status: 'applied',
          receipt: { area: 'portal', changes: expect.any(Array) },
        })
        expect(applied.json.receipt).toHaveProperty('id')
        expect(applied.json.receipt).toHaveProperty('undoable')
        await waitForAudit({ tool: 'update_settings', credentialId: key.id })
        const [settingsAudit] = await supportDb()`SELECT event_type FROM audit_log
          WHERE event_type = 'settings.applied' AND credential_id = ${key.id}`
        expect(settingsAudit).toBeTruthy()
        expect(await (await fetch(`${baseURL}/`)).text()).toContain(newName)

        expectToolError(
          await mcpCall(key.api, 'update_settings', {
            area: 'portal',
            patch: { displayName: `${newName} 2` },
            expected_revision: revision,
          }),
          /\(code: REVISION_MISMATCH\)$/
        )
        const fresh = (await mcpCall(key.api, 'get_settings', { area: 'portal' })).json.revision
        const noop = await mcpCall(key.api, 'update_settings', {
          area: 'portal',
          patch: { displayName: newName },
          expected_revision: fresh,
        })
        expect(noop.json.status).toBe('noop')
      } finally {
        await supportDb()`UPDATE settings SET name = ${originalName}`
        await bustSettingsCache()
      }
    }
  )

  test(
    "API-M-87 update_settings asks each area's own permission",
    { tag: '@nightly' },
    async ({ playwright, baseURL, marker }) => {
      const designer = newTeammate(`${marker} designer`, ['settings.branding', 'member.view'])
      const oauth = await oauthApi(playwright, baseURL, designer.email, ALL_SCOPES)
      const branding = await mcpCall(oauth, 'update_settings', {
        area: 'branding',
        patch: { themeMode: 'dark' },
        dry_run: true,
      })
      expect(branding.isError, branding.text).toBe(false)
      expect(branding.json.status).toBe('dry_run')
      expectToolError(
        await mcpCall(oauth, 'update_settings', {
          area: 'modules',
          patch: {},
          dry_run: true,
        }),
        permissionError('settings.manage')
      )
      expectToolError(
        await mcpCall(oauth, 'update_settings', {
          area: 'office_hours',
          patch: {},
          dry_run: true,
        }),
        permissionError('office_hours.manage')
      )
      const rows = await waitForAudit({
        tool: 'update_settings',
        onBehalfOf: designer.principalId,
      })
      expect(rows.map((r) => r.metadata.errorCode ?? 'ok')).toEqual([
        'ok',
        'MISSING_PERMISSION',
        'MISSING_PERMISSION',
      ])
    }
  )

  test(
    'API-M-88 update_settings does not change the changelog area without write:changelog',
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people }) => {
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:settings', 'write:settings'],
      })
      const admin = await adminApi(playwright, baseURL, people)
      const before = await mcpCall(admin, 'get_settings', { area: 'changelog' })
      const autoSubscribe = before.json.settings.autoSubscribe as boolean
      expect(typeof autoSubscribe).toBe('boolean')
      try {
        const res = await mcpCall(key.api, 'update_settings', {
          area: 'changelog',
          patch: { autoSubscribe: !autoSubscribe },
          expected_revision: before.json.revision,
        })
        expectToolError(res, /write:changelog/)
        const rest = await key.api.patch('/api/v1/settings/changelog', {
          headers: { 'if-match': before.json.revision },
          data: { autoSubscribe: !autoSubscribe },
        })
        expect(rest.status()).toBe(403)
        expect(await rest.text()).toContain(
          "This API key is missing the 'write:changelog' scope required by 'changelog.manage'"
        )
      } finally {
        // Put the area back (a no-op when the refusal held).
        const now = await mcpCall(admin, 'get_settings', { area: 'changelog' })
        await mcpCall(admin, 'update_settings', {
          area: 'changelog',
          patch: { autoSubscribe },
          expected_revision: now.json.revision,
        })
      }
    }
  )
})

test.describe('MCP navigation and widget tools', () => {
  test(
    'API-M-89 navigate_workspace returns links the caller may open, and refuses the rest',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      for (const [destination, href] of [
        ['feedback', '/admin/feedback'],
        ['boards', '/admin/settings/boards'],
        ['changelog', '/admin/changelog'],
        ['articles', '/admin/help-center'],
        ['status', '/admin/status'],
        ['members', '/admin/settings/members'],
        ['api_keys', '/admin/settings/developers'],
      ] as const) {
        const res = await mcpCall(admin, 'navigate_workspace', { destination })
        expect(res.isError, `${destination}: ${res.text}`).toBe(false)
        expect(res.json).toMatchObject({
          navigation: { href, label: expect.any(String) },
          reason: 'continue_in_settings',
        })
      }
      const member = newTeammate(`${marker} member`, ['post.view_private', 'member.view'])
      const key = await keyApi(playwright, baseURL, { creatorEmail: member.email })
      expectToolError(
        await mcpCall(key.api, 'navigate_workspace', { destination: 'boards' }),
        permissionError('board.manage')
      )
      const unknown = await rawRpc(
        admin,
        toolCallMsg('navigate_workspace', { destination: 'nowhere' })
      )
      expect(JSON.stringify(unknown.body)).not.toContain('"href"')
    }
  )

  test(
    'API-M-90 widget_install_status reports the install without the secret, to teammates with read:feedback',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const res = await mcpCall(admin, 'widget_install_status', {})
      expect(res.isError, res.text).toBe(false)
      // Exactly these fields: no secret among them.
      expect(
        Object.keys(res.json)
          .filter((k) => k !== 'untrusted')
          .sort()
      ).toEqual(
        [
          'connected',
          'enabled',
          'lastDetectedAt',
          'originHost',
          'sdkVersion',
          'currentSdkVersion',
          'sdkNeedsUpdate',
        ].sort()
      )
      expect(typeof res.json.connected).toBe('boolean')

      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)
      expectToolError(
        await mcpCall(portal, 'widget_install_status', {}),
        'Error: This operation requires a team member (admin or member) role.'
      )
      const chatOnly = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat'],
      })
      expectToolError(
        await mcpCall(chatOnly.api, 'widget_install_status', {}),
        'Error: Insufficient scope. Required: read:feedback'
      )
    }
  )
})

test.describe('Admin MCP page', () => {
  test(
    "API-M-93 the admin setup guide's tool list matches the server's",
    {
      tag: '@nightly',
    },
    async ({ asPerson, playwright, baseURL, people }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const tools = (await (await mcpRpc(admin, 'tools/list')).json()).result.tools as Array<{
        name: string
      }>
      const page = await asPerson('admin')
      await page.goto('/admin/settings/developers?tab=mcp')
      await expect(page.getByText(`${tools.length} tools available`)).toBeVisible()
      await expect(page.getByText('list_suggestions', { exact: true })).toHaveCount(0)
    }
  )
})
