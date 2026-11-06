import { createId } from '@quackback/ids'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { settings, eq, assistantPendingActions, principal, apiKeys } from '@/lib/server/db'
import { ASK_GOLDEN_CASES } from '../evals/ask-golden'
import { createAskMcpFixture } from '../evals/ask-mcp-fixture'
import { seedAskGoldenFixture } from '../evals/ask-golden-fixtures'
import { openAskSdkHarness, parseAskSdkResult } from '../evals/ask-sdk-harness'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
          const result = await sdk.call('update_settings', {
            area,
            patch: { enabled: true },
            dry_run: true,
          })
          expect(result.isError).toBe(true)
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
  it('reads an operator-managed name and opens General', async () => {
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
  it('opens Domains for a holder of any permission the page opens to, and no one else', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      for (const permission of [
        PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
        PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
        PERMISSIONS.AUTH_MANAGE,
      ]) {
        const sdk = await openAskSdkHarness({
          ...seeded.auth,
          scopes: ['read:settings'],
          permissions: new Set([PERMISSIONS.COPILOT_USE, permission]),
        })
        try {
          const result = await sdk.call('navigate_workspace', { destination: 'domains' })
          expect(result.isError, `${permission}: ${JSON.stringify(result.content)}`).not.toBe(true)
          expect(parseAskSdkResult(result)).toMatchObject({
            navigation: { href: '/admin/settings/domains' },
          })
        } finally {
          await sdk.close()
        }
      }
      const none = await openAskSdkHarness({
        ...seeded.auth,
        scopes: ['read:settings'],
        permissions: new Set([PERMISSIONS.COPILOT_USE, PERMISSIONS.SETTINGS_MANAGE]),
      })
      try {
        expect((await none.call('navigate_workspace', { destination: 'domains' })).isError).toBe(
          true
        )
      } finally {
        await none.close()
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
          ['update_settings', { area: 'messenger', patch: { enabled: true }, dry_run: true }],
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
  it('rechecks live key scopes and creator authority for a service key', async () => {
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
        keyHash: `fixture-key-hash-${keyId}`,
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
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).not.toBe(true)
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
        expect((await sdk.call('get_settings', { area: 'branding' })).isError).toBe(true)
      } finally {
        await sdk.close()
      }
    })
  })
})
