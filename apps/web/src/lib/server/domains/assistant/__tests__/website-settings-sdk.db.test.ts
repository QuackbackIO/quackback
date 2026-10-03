// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { BrandingTransportState, S3FixtureModule } from './website-settings-sdk.fixture'
import { BRANDING_PNG } from './website-settings-sdk.fixture'
import { createAskMcpFixture } from '@/lib/server/mcp/evals/ask-mcp-fixture'
import { seedAskGoldenFixture } from '@/lib/server/mcp/evals/ask-golden-fixtures'
import { openAskSdkHarness, parseAskSdkResult } from '@/lib/server/mcp/evals/ask-sdk-harness'
import {
  settings,
  eq,
  assistantPendingActions,
  auditLog,
  principal,
  user,
  type Database,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import { createWorkspaceThread } from '../workspace-threads.service'
import {
  applyWorkspaceSettingsProposal,
  undoWorkspaceSettingsProposal,
} from '../workspace-settings-actions.service'
import { deleteObject, getS3Object } from '@/lib/server/storage/s3'

const transport = vi.hoisted((): BrandingTransportState => ({
  live: process.env.QB_PHASE5_BRAND_FIXTURE === '1',
  lookups: [],
  requests: [],
  objects: new Map(),
  created: new Set(),
}))
vi.mock('node:dns/promises', async (original) => {
  const actual = await original<typeof import('node:dns/promises')>()
  const { brandingDns } = await import('./website-settings-sdk.fixture')
  return {
    ...actual,
    lookup: async (host: string, options: { all?: boolean }) => {
      if (['example.com', 'assets.example.com'].includes(host)) transport.lookups.push(host)
      return transport.live
        ? actual.lookup(host, options as { all: true })
        : brandingDns(host, options)
    },
  }
})
vi.mock('node:https', async (original) => {
  const actual = await original<typeof import('node:https')>()
  const { brandingRequest } = await import('./website-settings-sdk.fixture')
  return {
    ...actual,
    request: (
      options: Parameters<typeof brandingRequest>[1],
      callback: Parameters<typeof brandingRequest>[2]
    ) => {
      if (['example.com', 'assets.example.com'].includes(options.headers?.host))
        transport.requests.push(options)
      return transport.live
        ? actual.request(options, callback)
        : brandingRequest(transport, options, callback)
    },
  }
})
vi.mock('node:http', async (original) => {
  const actual = await original<typeof import('node:http')>()
  const { brandingRequest } = await import('./website-settings-sdk.fixture')
  return {
    ...actual,
    request: (
      options: Parameters<typeof brandingRequest>[1],
      callback: Parameters<typeof brandingRequest>[2]
    ) => {
      if (['example.com', 'assets.example.com'].includes(options.headers?.host))
        transport.requests.push(options)
      return transport.live
        ? actual.request(options, callback)
        : brandingRequest(transport, options, callback)
    },
  }
})
vi.mock('@aws-sdk/client-s3', async (original) => {
  const actual = await original<S3FixtureModule>()
  const { brandingS3Client } = await import('./website-settings-sdk.fixture')
  return { ...actual, S3Client: brandingS3Client(transport, actual) }
})
let fixture: Awaited<ReturnType<typeof createAskMcpFixture>>
beforeAll(async () => {
  vi.stubEnv('BASE_URL', process.env.BASE_URL || 'http://localhost:3100')
  vi.stubEnv('SECRET_KEY', process.env.SECRET_KEY || 'acme-website-test-secret-0123456789')
  if (transport.live) {
    const endpoint = process.env.S3_ENDPOINT
    if (
      !endpoint ||
      !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname) ||
      !process.env.S3_BUCKET ||
      !process.env.S3_ACCESS_KEY_ID ||
      !process.env.S3_SECRET_ACCESS_KEY
    )
      throw new Error('Live website SDK requires the local fixture and MinIO configuration')
    fixture = await createAskMcpFixture({
      storage: {
        bucket: process.env.S3_BUCKET,
        endpoint,
        region: process.env.S3_REGION ?? 'auto',
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      },
      secrets: {
        storage: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      },
    })
  } else fixture = await createAskMcpFixture()
}, 120_000)
beforeEach(() => {
  transport.lookups.length = 0
  transport.requests.length = 0
  transport.objects.clear()
  transport.created.clear()
})
afterAll(async () => {
  await fixture?.close()
  vi.unstubAllEnvs()
})
async function run(work: (database: Database) => Promise<void>) {
  await fixture.run(async (database) => {
    try {
      await work(database)
    } finally {
      for (const key of transport.created) await deleteObject(key)
    }
  })
}
const websiteRequest = {
  changes: [
    { area: 'branding', patch: { website: 'https://example.com' } },
    { area: 'messenger', patch: { enabled: true } },
  ],
}
async function proposal(
  sdk: Awaited<ReturnType<typeof openAskSdkHarness>>,
  input: Record<string, unknown> = websiteRequest
) {
  const result = await sdk.call('propose_settings_change', input)
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
  const parsed = parseAskSdkResult(result)
  expect(parsed.note).toContain('not instructions')
  return {
    id: parsed.pendingActionId as typeof assistantPendingActions.$inferSelect.id,
    args: settingsProposalSchema.parse(parsed.proposal),
  }
}
function values(row: typeof settings.$inferSelect) {
  const parsed = (value: string | null) => (value === null ? null : JSON.parse(value))
  return {
    logoKey: row.logoKey,
    brandingConfig: parsed(row.brandingConfig),
    widgetConfig: parsed(row.widgetConfig),
    featureFlags: parsed(row.featureFlags),
    portalConfig: parsed(row.portalConfig),
    metadata: parsed(row.metadata),
    name: row.name,
  }
}
async function otherActor(database: Database): Promise<Actor> {
  const userId = createId('user'),
    principalId = createId('principal')
  await database.insert(user).values({ id: userId, name: 'Acme', email: 'you+other@example.com' })
  await database
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(ALL_PERMISSIONS),
  }
}

describe('website settings through real MCP SDK, Postgres and scoped storage', () => {
  it('preserves explicit colors across separate branding entries regardless of inferred website order', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const pending = await proposal(sdk, {
          changes: [
            {
              area: 'branding',
              patch: { light: { primary: '#FFFFFF' }, dark: { primary: '#ABCDEF' } },
            },
            ...websiteRequest.changes,
          ],
        })
        expect(pending.args.changes.find(({ id }) => id === 'branding.light.primary')?.after).toBe(
          '#FFFFFF'
        )
        expect(pending.args.changes.find(({ id }) => id === 'branding.dark.primary')?.after).toBe(
          '#ABCDEF'
        )
      } finally {
        await sdk.close()
      }
    })
  })
  it('offers one canonical card, changes only selected fields, and restores coupled settings on Undo', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const read = async () =>
        (await database.select().from(settings).where(eq(settings.id, seeded.workspace.id)))[0]
      const before = await read(),
        sdk = await openAskSdkHarness(seeded.auth)
      try {
        const pending = await proposal(sdk)
        expect(pending.args.changes.map(({ id }) => id).sort()).toEqual([
          'branding.dark.primary',
          'branding.light.primary',
          'branding.logoKey',
          'messenger.enabled',
        ])
        expect(pending.args.changes.filter(({ path }) => path[0] === 'website')).toEqual([])
        const logo = pending.args.changes.find(({ id }) => id === 'branding.logoKey')!
        expect(logo).toMatchObject({
          before: null,
          after: expect.stringMatching(/^logos\/[a-f0-9]{64}\.png$/),
          afterPreview: '/api/storage/' + logo.after,
        })
        expect(
          pending.args.changes.filter(({ id }) => id.endsWith('.primary')).map(({ after }) => after)
        ).toEqual(['#0F766E', '#0F766E'])
        expect(await read()).toEqual(before)
        expect(await database.select().from(assistantPendingActions)).toHaveLength(1)
        expect(await database.select().from(auditLog)).toHaveLength(0)
        expect(transport.requests.map(({ headers, path }) => headers.host + path)).toEqual([
          'example.com/',
          'example.com/touch.png',
          'assets.example.com/logo.png',
        ])
        const selected = ['branding.logoKey', 'messenger.enabled']
        await applyWorkspaceSettingsProposal(seeded.actor, pending.id, selected)
        const after = await read()
        expect(after.logoKey).toBe(logo.after)
        expect(after.brandingConfig).toBe(before.brandingConfig)
        expect(JSON.parse(after.widgetConfig!).messenger.enabled).toBe(true)
        expect(JSON.parse(after.widgetConfig!).tabs.messenger).toBe(true)
        expect(JSON.parse(after.featureFlags!).supportInbox).toBe(true)
        const [audit] = await database
          .select()
          .from(auditLog)
          .where(eq(auditLog.targetId, pending.id))
        expect(audit.metadata).toMatchObject({ via: 'copilot' })
        await undoWorkspaceSettingsProposal(seeded.actor, pending.id)
        expect(values(await read())).toEqual(values(before))
        const stored = await getS3Object(logo.after as string)
        const bytes = Buffer.from(await new Response(stored.body).arrayBuffer())
        expect(stored.contentType).toBe('image/png')
        if (transport.live)
          expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
        else expect(bytes).toEqual(BRANDING_PNG)
        expect(
          await database.select().from(auditLog).where(eq(auditLog.targetId, pending.id))
        ).toHaveLength(2)
      } finally {
        await sdk.close()
      }
    })
  })
  it('applies the entire inferred card and restores raw absent values while preserving later metadata siblings', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      await database
        .update(settings)
        .set({ brandingConfig: null, metadata: JSON.stringify({ keep: 'Acme' }) })
        .where(eq(settings.id, seeded.workspace.id))
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const pending = await proposal(sdk)
        await applyWorkspaceSettingsProposal(
          seeded.actor,
          pending.id,
          pending.args.changes.map(({ id }) => id)
        )
        const [after] = await database
          .select()
          .from(settings)
          .where(eq(settings.id, seeded.workspace.id))
        expect(JSON.parse(after.brandingConfig!)).toEqual({
          light: { primary: '#0F766E' },
          dark: { primary: '#0F766E' },
        })
        await database
          .update(settings)
          .set({ metadata: JSON.stringify({ ...JSON.parse(after.metadata!), later: 'keep' }) })
          .where(eq(settings.id, seeded.workspace.id))
        await undoWorkspaceSettingsProposal(seeded.actor, pending.id)
        const [undone] = await database
          .select()
          .from(settings)
          .where(eq(settings.id, seeded.workspace.id))
        expect(undone.logoKey).toBeNull()
        expect(undone.brandingConfig).toBeNull()
        expect(JSON.parse(undone.metadata!)).toEqual({ keep: 'Acme', later: 'keep' })
      } finally {
        await sdk.close()
      }
    })
  })
  it('rolls back selected logo, colors, Messenger, status and audit when a real managed-name writer refuses', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      await database
        .update(settings)
        .set({ managedFieldPaths: ['workspace.name'] })
        .where(eq(settings.id, seeded.workspace.id))
      const [before] = await database
        .select()
        .from(settings)
        .where(eq(settings.id, seeded.workspace.id))
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const pending = await proposal(sdk, {
          changes: [
            ...websiteRequest.changes,
            { area: 'portal', patch: { displayName: 'Acme team' } },
          ],
        })
        await expect(
          applyWorkspaceSettingsProposal(
            seeded.actor,
            pending.id,
            pending.args.changes.map(({ id }) => id)
          )
        ).rejects.toThrow(/managed/i)
        const [after] = await database
          .select()
          .from(settings)
          .where(eq(settings.id, seeded.workspace.id))
        expect(values(after)).toEqual(values(before))
        const [action] = await database
          .select()
          .from(assistantPendingActions)
          .where(eq(assistantPendingActions.id, pending.id))
        expect(action.status).toBe('proposed')
        expect(action.result).toBeNull()
        expect(
          await database.select().from(auditLog).where(eq(auditLog.targetId, pending.id))
        ).toHaveLength(0)
      } finally {
        await sdk.close()
      }
    })
  })
  it.each(['manage', 'branding', 'empty', 'current'] as const)(
    'checks %s permission before any DNS, fetch or storage request',
    async (ceiling) => {
      await run(async (database) => {
        const seeded = await seedAskGoldenFixture(
          database,
          ceiling === 'current' ? 'no_settings' : 'owner'
        )
        const permissions =
          ceiling === 'current'
            ? undefined
            : new Set(
                ceiling === 'empty'
                  ? []
                  : ALL_PERMISSIONS.filter(
                      (permission) =>
                        permission !==
                        (ceiling === 'manage'
                          ? PERMISSIONS.SETTINGS_MANAGE
                          : PERMISSIONS.SETTINGS_BRANDING)
                    )
              )
        const sdk = await openAskSdkHarness({ ...seeded.auth, permissions })
        try {
          expect(
            (
              await sdk.call(
                'propose_settings_change',
                ceiling === 'manage' ? { changes: [websiteRequest.changes[0]] } : websiteRequest
              )
            ).isError
          ).toBe(true)
          expect(transport.lookups).toEqual([])
          expect(transport.requests).toEqual([])
          expect(transport.created.size).toBe(0)
          expect(await database.select().from(assistantPendingActions)).toHaveLength(0)
        } finally {
          await sdk.close()
        }
      })
    }
  )
  it('refuses a foreign proposal parent before fetching and keeps Apply and Undo private', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner'),
        other = await otherActor(database)
      const foreignThread = await createWorkspaceThread(other)
      const foreign = await openAskSdkHarness({
        ...seeded.auth,
        workspaceThreadKey: foreignThread.key,
      })
      try {
        expect((await foreign.call('propose_settings_change', websiteRequest)).isError).toBe(true)
      } finally {
        await foreign.close()
      }
      expect(transport.lookups).toEqual([])
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const pending = await proposal(sdk),
          selected = pending.args.changes.map(({ id }) => id)
        await expect(
          applyWorkspaceSettingsProposal(other, pending.id, selected)
        ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
        await applyWorkspaceSettingsProposal(seeded.actor, pending.id, selected)
        await expect(undoWorkspaceSettingsProposal(other, pending.id)).rejects.toMatchObject({
          code: 'WORKSPACE_THREAD_NOT_FOUND',
        })
      } finally {
        await sdk.close()
      }
    })
  })
  it('refuses raw logo keys and unsafe websites without creating a card or uploading data', async () => {
    await run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner'),
        sdk = await openAskSdkHarness(seeded.auth)
      try {
        for (const patch of [
          { logoKey: 'logos/raw.png' },
          { website: 'http://127.0.0.1' },
          { website: 'http://169.254.169.254' },
          { website: 'javascript:alert(1)' },
          { website: 'https://you:secret@example.com' },
        ]) {
          expect(
            (await sdk.call('propose_settings_change', { changes: [{ area: 'branding', patch }] }))
              .isError
          ).toBe(true)
        }
        expect(transport.requests).toEqual([])
        expect(transport.created.size).toBe(0)
        expect(await database.select().from(assistantPendingActions)).toHaveLength(0)
      } finally {
        await sdk.close()
      }
    })
  })
})
