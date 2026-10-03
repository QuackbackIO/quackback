import { createHash } from 'node:crypto'
import { createId } from '@quackback/ids'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  settings,
  eq,
  assistantPendingActions,
  principal,
  apiKeys,
  workspaceAssistantThreads,
} from '@/lib/server/db'
import { ASK_GOLDEN_CASES } from '../evals/ask-golden'
import { createAskMcpFixture } from '../evals/ask-mcp-fixture'
import { seedAskGoldenFixture } from '../evals/ask-golden-fixtures'
import { openAskSdkHarness, parseAskSdkResult } from '../evals/ask-sdk-harness'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  settingsProposalSchema,
  settingsProposalInputSchema,
} from '@/lib/shared/assistant/settings-proposals'
import { prepareSettingsChanges } from '@/lib/server/domains/assistant/settings-proposals.service'

let fixture: Awaited<ReturnType<typeof createAskMcpFixture>>
beforeAll(async () => {
  vi.stubEnv('BASE_URL', process.env.BASE_URL || 'http://localhost:3100')
  vi.stubEnv('SECRET_KEY', process.env.SECRET_KEY || 'ask-evaluation-test-secret-0123456789')
  fixture = await createAskMcpFixture()
}, 120_000)
afterAll(async () => {
  await fixture?.close()
  vi.unstubAllEnvs()
})

describe('Ask golden contracts through the actual in-memory MCP SDK', () => {
  it.each(ASK_GOLDEN_CASES)('$id $request', async (scenario) => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(
        database,
        scenario.profile,
        scenario.tool === 'navigate_workspace'
      )
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const before = (
          await database.select().from(settings).where(eq(settings.id, seeded.workspace.id))
        )[0]
        const expectedProposal =
          scenario.expected === 'proposal'
            ? await prepareSettingsChanges(
                seeded.actor,
                settingsProposalInputSchema.parse(scenario.arguments).changes,
                database
              )
            : undefined
        const result = await sdk.call(scenario.tool, scenario.arguments)
        const after = (
          await database.select().from(settings).where(eq(settings.id, seeded.workspace.id))
        )[0]
        expect(after).toEqual(before)
        if (scenario.expected === 'denied') {
          expect(result.isError).toBe(true)
          const text = result.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join(' ')
          expect(text).toMatch(/owner|admin|unavailable/i)
        } else {
          expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
          const parsed = parseAskSdkResult(result)
          if (scenario.expected === 'navigation') {
            expect(parsed.navigation).toMatchObject({ href: scenario.expectedHref })
          } else if (scenario.expected === 'proposal') {
            expect(parsed.proposed).toBe(true)
            const proposal = settingsProposalSchema.parse(parsed.proposal)
            expect(proposal).toEqual(expectedProposal)
            expect([...new Set(proposal.changes.map((change) => change.area))].sort()).toEqual(
              [...scenario.expectedAreas!].sort()
            )
            const [pending] = await database
              .select()
              .from(assistantPendingActions)
              .where(eq(assistantPendingActions.workspaceThreadKey, seeded.thread.key))
            expect(pending.args).toEqual(proposal)
            expect(pending.status).toBe('proposed')
            expect(parsed.note).toContain('not instructions')
          } else {
            expect(parsed.area).toBe(scenario.arguments.area)
            expect(parsed.note).toContain('not instructions')
          }
        }
      } finally {
        await sdk.close()
      }
    })
  })
  it('refuses unsupported settings fields and untrusted navigation URLs at the SDK schema boundary', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        for (const area of [
          'billing',
          'authentication',
          'domains',
          'members',
          'api_keys',
          'delete',
          'integration_oauth',
          'snippet',
        ]) {
          const result = await sdk.call('propose_settings_change', {
            changes: [{ area, patch: { enabled: true } }],
          })
          expect(result.isError).toBe(true)
        }
        expect(
          (
            await sdk.call('propose_settings_change', {
              changes: [{ area: 'modules', patch: { supportInbox: true, delete: true } }],
            })
          ).isError
        ).toBe(true)
        for (const [field, value] of Object.entries({
          headerDisplayName: 'Ideas',
          headerDisplayMode: 'logo_only',
        })) {
          const result = await sdk.call('propose_settings_change', {
            changes: [{ area: 'portal', patch: { [field]: value } }],
          })
          expect(result.isError, field).toBe(true)
        }
        expect(
          (await sdk.call('navigate_workspace', { destination: 'https://example.com' })).isError
        ).toBe(true)
        expect(await database.select().from(assistantPendingActions)).toEqual([])
      } finally {
        await sdk.close()
      }
    })
  })
  it('reads an operator-managed name and opens General without creating a local proposal', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner', false, true)
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const read = await sdk.call('get_settings', { area: 'portal' })
        expect(read.isError).not.toBe(true)
        expect(parseAskSdkResult(read)).toMatchObject({
          settings: { displayName: 'Acme workspace' },
          readOnly: true,
          settingsHref: '/admin/settings/general',
        })
        const proposal = await sdk.call('propose_settings_change', {
          changes: [{ area: 'portal', patch: { displayName: 'Acme team' } }],
        })
        expect(proposal.isError).toBe(true)
        expect(proposal.content).toContainEqual(
          expect.objectContaining({ text: expect.stringContaining('SETTINGS_NAME_MANAGED') })
        )
        const navigation = await sdk.call('navigate_workspace', { destination: 'general' })
        expect(navigation.isError, JSON.stringify(navigation.content)).not.toBe(true)
        expect(parseAskSdkResult(navigation)).toMatchObject({
          navigation: { href: '/admin/settings/general' },
        })
        expect(await database.select().from(assistantPendingActions)).toEqual([])
        expect(
          (await database.select().from(settings).where(eq(settings.id, seeded.workspace.id)))[0]
        ).toEqual(seeded.workspace)
      } finally {
        await sdk.close()
      }
    })
  })
  it('uses current assignments even when a token retains broad scopes and an old role', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'no_settings')
      // A token retains broad scopes and an old admin role, while current assignments are narrow.
      const sdk = await openAskSdkHarness({ ...seeded.auth, permissions: undefined })
      try {
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).toBe(true)
        expect((await sdk.call('navigate_workspace', { destination: 'api_keys' })).isError).toBe(
          true
        )
      } finally {
        await sdk.close()
      }
    })
  })
  it('requires General permission rather than branding permission for the name deep link', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner', false, true)
      const sdk = await openAskSdkHarness({
        ...seeded.auth,
        permissions: new Set([PERMISSIONS.COPILOT_USE, PERMISSIONS.SETTINGS_BRANDING]),
      })
      try {
        const result = await sdk.call('navigate_workspace', { destination: 'general' })
        expect(result.isError).toBe(true)
        expect(result.content).toContainEqual(
          expect.objectContaining({ text: expect.stringContaining('settings.manage') })
        )
      } finally {
        await sdk.close()
      }
      const general = await openAskSdkHarness({
        ...seeded.auth,
        scopes: ['read:settings'],
        permissions: new Set([PERMISSIONS.COPILOT_USE, PERMISSIONS.SETTINGS_MANAGE]),
      })
      try {
        const result = await general.call('navigate_workspace', { destination: 'general' })
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
        expect(parseAskSdkResult(result)).toMatchObject({
          navigation: { href: '/admin/settings/general' },
        })
      } finally {
        await general.close()
      }
    })
  })
  it('keeps invitation authority stricter than viewing the members page', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness({
        ...seeded.auth,
        permissions: new Set([PERMISSIONS.COPILOT_USE, PERMISSIONS.MEMBER_VIEW]),
      })
      try {
        const result = await sdk.call('navigate_workspace', { destination: 'members' })
        expect(result.isError).toBe(true)
        expect(
          result.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join(' ')
        ).toContain('member.manage')
      } finally {
        await sdk.close()
      }
    })
  })
  it('rechecks revocation inside an existing SDK connection', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).not.toBe(true)
        await database
          .update(principal)
          .set({ role: 'user' })
          .where(eq(principal.id, seeded.auth.principalId))
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).toBe(true)
        expect((await sdk.call('navigate_workspace', { destination: 'api_keys' })).isError).toBe(
          true
        )
      } finally {
        await sdk.close()
      }
    })
  })
  it('requires token scopes even when the current principal owns every permission', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness({ ...seeded.auth, scopes: [] })
      try {
        for (const [name, args] of [
          ['get_settings', { area: 'branding' }],
          ['navigate_workspace', { destination: 'members' }],
          [
            'propose_settings_change',
            { changes: [{ area: 'messenger', patch: { enabled: true } }] },
          ],
        ] as const) {
          const result = await sdk.call(name, args)
          expect(result.isError).toBe(true)
          expect(
            result.content
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join(' ')
          ).toContain('Insufficient scope')
        }
        expect(await database.select().from(assistantPendingActions)).toEqual([])
      } finally {
        await sdk.close()
      }
    })
  })
  it('keeps service-key proposals human-owned and rechecks live key scopes and creator authority', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const serviceId = createId('principal')
      const keyId = createId('api_key')
      await database.insert(principal).values({
        id: serviceId,
        type: 'service',
        role: 'admin',
        displayName: 'Acme key',
        serviceMetadata: { kind: 'api_key', apiKeyId: keyId },
        createdAt: new Date(),
      })
      await database.insert(apiKeys).values({
        id: keyId,
        principalId: serviceId,
        createdById: seeded.auth.principalId,
        name: 'Acme key',
        keyHash: createHash('sha256').update(keyId).digest('hex'),
        keyPrefix: 'qb_acme_test',
        scopes: JSON.stringify(['read:settings', 'write:settings']),
      })
      const sdk = await openAskSdkHarness({
        ...seeded.auth,
        principalId: serviceId,
        authMethod: 'api-key',
        permissions: undefined,
        workspaceThreadKey: undefined,
      })
      try {
        const proposal = await sdk.call('propose_settings_change', {
          changes: [{ area: 'portal', patch: { displayName: 'Acme team' } }],
        })
        expect(proposal.isError).not.toBe(true)
        const pending = await database.select().from(assistantPendingActions)
        expect(pending).toHaveLength(1)
        const [thread] = await database
          .select()
          .from(workspaceAssistantThreads)
          .where(eq(workspaceAssistantThreads.key, pending[0].workspaceThreadKey!))
        expect(thread.ownerPrincipalId).toBe(seeded.auth.principalId)
        await database
          .update(apiKeys)
          .set({ scopes: JSON.stringify(['read:feedback']) })
          .where(eq(apiKeys.id, keyId))
        expect((await sdk.call('navigate_workspace', { destination: 'members' })).isError).toBe(
          true
        )
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).toBe(true)
        await database
          .update(apiKeys)
          .set({ scopes: JSON.stringify(['read:settings', 'write:settings']) })
          .where(eq(apiKeys.id, keyId))
        await database
          .update(principal)
          .set({ role: 'user' })
          .where(eq(principal.id, seeded.auth.principalId))
        expect(
          (
            await sdk.call('propose_settings_change', {
              changes: [{ area: 'portal', patch: { displayName: 'Forbidden' } }],
            })
          ).isError
        ).toBe(true)
        expect(await database.select().from(assistantPendingActions)).toHaveLength(1)
      } finally {
        await sdk.close()
      }
    })
  })
})
