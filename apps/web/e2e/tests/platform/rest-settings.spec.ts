/**
 * Workspace settings over the public REST API (/api/v1/settings): listing
 * and reading areas, the change preconditions, applying a change with a
 * receipt, undoing it, and the scopes each area needs.
 *
 * Journeys: API-R-173, API-R-174, API-R-175, API-R-176, API-R-177,
 * API-R-178, API-R-179.
 *
 * Shared-run tests change only the office-hours holiday list, with a date in
 * 2099 that no schedule ever reaches, and put it back. The changelog and
 * module areas change what every test sees, so those run in the isolated job.
 * Not here: API-R-175's locked-field 423 (needs a config-file lock).
 */
import { generateId } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiFor, createKey, expectJson, newTeammate, type Wire } from '../../support/api-client'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { adminApi, missingScope, roleKeyOf, uuid } from '../../product/api-rest-content'

test.describe.configure({ timeout: 60_000 })

const AREA_IDS = [
  'branding',
  'changelog',
  'languages',
  'messenger',
  'modules',
  'office_hours',
  'portal',
]
const SETTINGS = ['read:settings', 'write:settings']

async function readArea(api: APIRequestContext, area: string): Promise<Wire> {
  return (await expectJson(await api.get(`/api/v1/settings/${area}`), 200)).data
}

function patchArea(
  api: APIRequestContext,
  area: string,
  data: unknown,
  revision?: string,
  dryRun = false
) {
  return api.patch(`/api/v1/settings/${area}${dryRun ? '?dry_run=true' : ''}`, {
    data,
    headers: revision ? { 'if-match': `"${revision}"` } : {},
  })
}

/** A workspace key on a role holding exactly `permissions`. */
async function roleApi(
  playwright: Parameters<typeof apiFor>[0],
  baseURL: string | undefined,
  adminEmail: string,
  name: string,
  permissions: string[],
  scopes = SETTINGS
): Promise<APIRequestContext> {
  newTeammate(name, permissions)
  const { key } = createKey({
    creatorEmail: adminEmail,
    kind: 'workspace',
    roleKey: roleKeyOf(name),
    scopes,
  })
  return apiFor(playwright, baseURL, key)
}

test.describe('REST settings: reads', () => {
  test(
    'API-R-173 the list shows the areas the key may read; a key without read:settings is refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api: admin } = await adminApi(playwright, baseURL, people, { scopes: SETTINGS })
      const list = await expectJson(await admin.get('/api/v1/settings'), 200)
      expect(list.data.map((a: Wire) => a.id).sort()).toEqual(AREA_IDS)
      for (const area of list.data) {
        expect(Object.keys(area).sort()).toEqual([
          'description',
          'gates',
          'id',
          'locked',
          'revision',
          'title',
        ])
        expect(Object.keys(area.gates)).toEqual(['permission'])
      }

      const hoursOnly = await roleApi(
        playwright,
        baseURL,
        people.people.admin.email,
        `Hours keeper ${marker}`,
        ['office_hours.manage']
      )
      const narrow = await expectJson(await hoursOnly.get('/api/v1/settings'), 200)
      expect(narrow.data.map((a: Wire) => a.id)).toEqual(['office_hours'])

      const { api: feedback } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:feedback'],
      })
      const refused = await expectJson(await feedback.get('/api/v1/settings'), 403)
      expect(refused.error).toEqual({
        code: 'FORBIDDEN',
        message: "This API key is missing the 'read:settings' scope",
      })
      for (const api of [admin, hoursOnly, feedback]) await api.dispose()
    }
  )

  test(
    'API-R-174 read one area with its ETag; unknown areas and areas outside the role are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people, { scopes: ['read:settings'] })
      const res = await api.get('/api/v1/settings/branding')
      const body = await expectJson(res, 200)
      expect(Object.keys(body.data).sort()).toEqual([
        'description',
        'gates',
        'id',
        'locked',
        'revision',
        'secrets',
        'title',
        'value',
      ])
      expect(body.data.id).toBe('branding')
      expect(res.headers()['etag']).toMatch(new RegExp(`^(W/)?"${body.data.revision}"$`))

      const missing = await expectJson(await api.get('/api/v1/settings/nope'), 404)
      expect(missing.error).toMatchObject({ code: 'NOT_FOUND', message: 'Settings area not found' })

      // A read-only settings key reads the changelog area (reads check no area scope).
      const changelog = await readArea(api, 'changelog')
      expect(Object.keys(changelog.value).sort()).toEqual([
        'audience',
        'autoSubscribe',
        'emailsDisabled',
      ])

      const hoursOnly = await roleApi(
        playwright,
        baseURL,
        people.people.admin.email,
        `Hours reader ${marker}`,
        ['office_hours.manage']
      )
      const refused = await expectJson(await hoursOnly.get('/api/v1/settings/modules'), 403)
      expect(refused.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Ask a workspace owner to make this change.',
      })
      // Positive control: the same key reads its own area.
      expect((await readArea(hoursOnly, 'office_hours')).id).toBe('office_hours')
      for (const k of [api, hoursOnly]) await k.dispose()
    }
  )
})

test.describe('REST settings: changes', () => {
  // Both tests change the office-hours area; one at a time keeps revisions honest.
  test.describe.configure({ mode: 'serial' })

  test(
    'API-R-175 a change needs If-Match and a JSON object; a dry run and refusals write nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people, { scopes: SETTINGS })
      const before = await readArea(api, 'office_hours')
      const holiday = { date: '2099-12-24', name: 'Dry run', recurringAnnual: false }

      const noMatch = await expectJson(await patchArea(api, 'office_hours', { holidays: [] }), 428)
      expect(noMatch.error).toEqual({
        code: 'IF_MATCH_REQUIRED',
        message: 'Send the revision you read as the If-Match header.',
      })

      const dry = await expectJson(
        await patchArea(api, 'office_hours', { holidays: [holiday] }, undefined, true),
        200
      )
      expect(dry.data).toMatchObject({ status: 'dry_run', area: 'office_hours' })
      expect(dry.data.changes).toEqual([
        { path: ['holidays'], before: before.value.holidays, after: [holiday] },
      ])

      const stale = await expectJson(
        await patchArea(api, 'office_hours', { holidays: [holiday] }, 'stale-revision'),
        412
      )
      expect(stale.error).toMatchObject({
        code: 'REVISION_MISMATCH',
        message:
          'These settings changed since you read them. Read them again and resend the change.',
        details: { revision: before.revision },
      })

      for (const res of [
        await patchArea(api, 'office_hours', [], before.revision),
        await api.patch('/api/v1/settings/office_hours', {
          data: Buffer.from('{not json'),
          headers: { 'content-type': 'application/json', 'if-match': `"${before.revision}"` },
        }),
      ]) {
        const body = await expectJson(res, 400)
        expect(body.error.message).toBe('Request body must be a JSON object')
      }
      const invalid = await expectJson(
        await patchArea(api, 'office_hours', { timezone: 'Nowhere/Land' }, before.revision),
        400
      )
      expect(invalid.error.code).toBe('VALIDATION_ERROR')

      const after = await readArea(api, 'office_hours')
      expect(after.revision).toBe(before.revision)
      expect(after.value).toEqual(before.value)
      await api.dispose()
    }
  )

  test(
    'API-R-176 API-R-177 apply a change for a receipt, a repeat is a no-op, and the receipt undoes once',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api, principalId } = await adminApi(playwright, baseURL, people, { scopes: SETTINGS })
      const start = await readArea(api, 'office_hours')
      const original = start.value.holidays
      const mine = { date: '2099-12-25', name: marker, recurringAnnual: false }
      try {
        // Apply.
        const res = await patchArea(
          api,
          'office_hours',
          { holidays: [...original, mine] },
          start.revision
        )
        const applied = await expectJson(res, 200)
        expect(applied.data.status).toBe('applied')
        const receipt = applied.data.receipt
        expect(Object.keys(receipt).sort()).toEqual(
          ['after', 'appliedAt', 'area', 'before', 'changes', 'id', 'revision', 'undoable'].sort()
        )
        expect(receipt).toMatchObject({ area: 'office_hours', undoable: true })
        expect(receipt.revision).not.toBe(start.revision)
        expect(res.headers()['etag']).toContain(receipt.revision)
        const read = await readArea(api, 'office_hours')
        expect(read.value.holidays).toContainEqual(mine)

        const [audit] = await supportDb()<{ event_type: string; metadata: Wire }[]>`
          SELECT event_type, metadata FROM audit_log WHERE id = ${uuid(receipt.id)}`
        expect(audit.event_type).toBe('settings.applied')
        expect(audit.metadata.principalId).toBe(principalId)

        // The same value again changes nothing.
        const noop = await expectJson(
          await patchArea(api, 'office_hours', { holidays: [...original, mine] }, read.revision),
          200
        )
        expect(noop.data).toEqual({ status: 'noop' })

        // A read-only key cannot undo; an unknown receipt is not found.
        const { api: reader } = await adminApi(playwright, baseURL, people, {
          scopes: ['read:settings'],
        })
        const noScope = await expectJson(
          await reader.post(`/api/v1/settings/receipts/${receipt.id}/undo`),
          403
        )
        expect(noScope.error.message).toBe("This API key is missing the 'write:settings' scope")
        await reader.dispose()
        const unknown = await expectJson(
          await api.post(`/api/v1/settings/receipts/${generateId('audit')}/undo`),
          404
        )
        expect(unknown.error.message).toBe('Settings receipt not found')

        // Undo restores the value, once.
        const undone = await expectJson(
          await api.post(`/api/v1/settings/receipts/${receipt.id}/undo`),
          200
        )
        expect(undone.data).toMatchObject({ id: receipt.id, area: 'office_hours', undone: true })
        expect((await readArea(api, 'office_hours')).value.holidays).toEqual(original)
        const [undoAudit] = await supportDb()<{ n: number }[]>`
          SELECT count(*)::int AS n FROM audit_log
          WHERE event_type = 'settings.undone' AND target_id = ${receipt.id}`
        expect(undoAudit.n).toBe(1)
        const twice = await expectJson(
          await api.post(`/api/v1/settings/receipts/${receipt.id}/undo`),
          409
        )
        expect(twice.error.message).toBe('This change was already undone')

        // A receipt whose field changed since cannot be undone.
        const r1 = await readArea(api, 'office_hours')
        const first = await expectJson(
          await patchArea(api, 'office_hours', { holidays: [...original, mine] }, r1.revision),
          200
        )
        const r2 = await readArea(api, 'office_hours')
        await expectJson(
          await patchArea(
            api,
            'office_hours',
            { holidays: [...original, { ...mine, name: `${marker} again` }] },
            r2.revision
          ),
          200
        )
        const conflict = await expectJson(
          await api.post(`/api/v1/settings/receipts/${first.data.receipt.id}/undo`),
          409
        )
        expect(conflict.error.code).toMatch(/CONFLICT/)
      } finally {
        const now = await readArea(api, 'office_hours')
        await patchArea(api, 'office_hours', { holidays: original }, now.revision)
        await api.dispose()
      }
    }
  )
})

test.describe('REST settings: workspace-wide areas', () => {
  test(
    'API-R-178 the changelog area also needs write:changelog',
    { tag: ['@nightly', '@isolated'] },
    async ({ playwright, baseURL, people }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const { api: settingsOnly } = await adminApi(playwright, baseURL, people, {
        scopes: SETTINGS,
      })
      const { api: both } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:settings', 'write:settings', 'write:changelog'],
      })
      const before = await readArea(settingsOnly, 'changelog')
      const refused = await expectJson(
        await patchArea(settingsOnly, 'changelog', { autoSubscribe: false }, before.revision),
        403
      )
      expect(refused.error.message).toBe(missingScope('write:changelog', 'changelog.manage'))
      expect((await readArea(settingsOnly, 'changelog')).revision).toBe(before.revision)

      const applied = await expectJson(
        await patchArea(both, 'changelog', { autoSubscribe: false }, before.revision),
        200
      )
      try {
        expect(applied.data.status).toBe('applied')
        expect((await readArea(both, 'changelog')).value.autoSubscribe).toBe(false)
      } finally {
        await expectJson(
          await both.post(`/api/v1/settings/receipts/${applied.data.receipt.id}/undo`),
          200
        )
      }
      expect((await readArea(both, 'changelog')).value.autoSubscribe).toBe(
        before.value.autoSubscribe
      )
      for (const api of [settingsOnly, both]) await api.dispose()
    }
  )

  test(
    'API-R-179 turning the help center off through settings hides its routes until undone',
    { tag: ['@nightly', '@isolated'] },
    async ({ playwright, baseURL, people }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const { api } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:settings', 'write:settings', 'read:article'],
      })
      // withSettings puts the module flags back even if the undo fails.
      await withSettings({ feature_flags: {} }, async () => {
        const before = await readArea(api, 'modules')
        expect(before.value.helpCenter).toBe(true)
        await expectJson(await api.get('/api/v1/help-center/categories'), 200)
        const applied = await expectJson(
          await patchArea(api, 'modules', { helpCenter: false }, before.revision),
          200
        )
        const hidden = await expectJson(await api.get('/api/v1/help-center/categories'), 404)
        expect(hidden.error.message).toBe('Knowledge base not found')
        await expectJson(
          await api.post(`/api/v1/settings/receipts/${applied.data.receipt.id}/undo`),
          200
        )
        await expectJson(await api.get('/api/v1/help-center/categories'), 200)
      })
      await api.dispose()
    }
  )
})

test.describe('REST settings: languages', () => {
  test(
    'API-R-180 the languages area shows the main language to every visitor and keeps a glossary',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, browser }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const { api } = await adminApi(playwright, baseURL, people, { scopes: SETTINGS })
      await withSettings(
        {
          language_config: { mainLanguage: 'de', visitorLanguage: 'own' },
          help_center_config: { 'autoTranslate.protectedTerms': [] },
        },
        async () => {
          const before = await readArea(api, 'languages')
          expect(before.value).toMatchObject({ mainLanguage: 'de', visitorLanguage: 'own' })
          const applied = await expectJson(
            await patchArea(
              api,
              'languages',
              { visitorLanguage: 'main', glossary: ['Quackback'] },
              before.revision
            ),
            200
          )
          expect(applied.data.status).toBe('applied')
          expect((await readArea(api, 'languages')).value).toMatchObject({
            visitorLanguage: 'main',
            glossary: ['Quackback'],
          })

          // A visitor whose browser asks for English now gets the main language.
          const context = await browser.newContext({
            extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
          })
          try {
            const page = await context.newPage()
            await page.goto(`${baseURL}/`)
            await expect(page.locator('html')).toHaveAttribute('lang', 'de')
          } finally {
            await context.close()
          }
        }
      )
      await api.dispose()
    }
  )
})
