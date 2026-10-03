import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createId } from '@quackback/ids'
import { createAskMcpFixture } from '@/lib/server/mcp/evals/ask-mcp-fixture'
import { seedAskGoldenFixture } from '@/lib/server/mcp/evals/ask-golden-fixtures'
import { openAskSdkHarness } from '@/lib/server/mcp/evals/ask-sdk-harness'
import {
  runAssistantTurn,
  isAssistantConfigured,
} from '@/lib/server/domains/assistant/assistant.runtime'
import {
  applyWorkspaceSettingsProposal,
  undoWorkspaceSettingsProposal,
} from '@/lib/server/domains/assistant/workspace-settings-actions.service'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import {
  JSON_COLUMNS,
  SCALAR_COLUMNS,
} from '@/lib/server/domains/assistant/settings-proposals.storage'
import { settings, principal, assistantPendingActions, auditLog, eq } from '@/lib/server/db'
import { getS3Object, deleteObject } from '@/lib/server/storage/s3'

let fixture: Awaited<ReturnType<typeof createAskMcpFixture>>
beforeAll(async () => {
  if (!isAssistantConfigured()) throw new Error('Website model evaluation requires a real model.')
  const endpoint = process.env.S3_ENDPOINT
  if (
    process.env.QB_PHASE5_BRAND_FIXTURE !== '1' ||
    !endpoint ||
    !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname) ||
    !process.env.S3_BUCKET ||
    !process.env.S3_ACCESS_KEY_ID ||
    !process.env.S3_SECRET_ACCESS_KEY
  )
    throw new Error(
      'Website model evaluation requires the owned HTTPS fixture and real local storage.'
    )
  fixture = await createAskMcpFixture({
    storage: {
      endpoint,
      bucket: process.env.S3_BUCKET,
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
}, 180_000)
afterAll(async () => fixture?.close())

describe('website branding with real model, MCP catalogue and local storage', () => {
  it('matches a website and enables Messenger in one reviewed card, then applies and undoes it', async () => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(database, 'owner')
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const catalogue = await sdk.client.listTools()
        expect(
          catalogue.tools.find((tool) => tool.name === 'propose_settings_change')
        ).toBeDefined()
      } finally {
        await sdk.close()
      }
      const assistantId = createId('principal')
      await database.insert(principal).values({
        id: assistantId,
        type: 'service',
        role: 'member',
        displayName: 'Copilot',
        createdAt: new Date(),
      })
      const before = (await database.select().from(settings))[0]
      let ownedLogo: string | undefined
      try {
        const result = await runAssistantTurn({
          role: 'workspace_assistant',
          surface: 'workspace',
          actor: seeded.actor,
          actorPrincipalId: seeded.actor.principalId,
          assistantPrincipalId: assistantId,
          workspaceThreadKey: seeded.thread.key,
          latestCustomerMessageId: 'website-golden-one',
          messages: [
            { sender: 'customer', content: 'Match my portal to example.com and turn on Messenger' },
          ],
          db: database,
          signal: AbortSignal.timeout(120_000),
        })
        expect(result.status).not.toBe('suppressed')
        if (result.status === 'suppressed') throw new Error('Website model turn was suppressed.')
        expect(result.trace.toolCalls).toContainEqual({
          name: 'propose_settings_change',
          outcome: 'proposed',
        })
        expect(result.proposedActions).toHaveLength(1)
        expect((await database.select().from(settings))[0]).toEqual(before)
        const pending = await database
          .select()
          .from(assistantPendingActions)
          .where(eq(assistantPendingActions.workspaceThreadKey, seeded.thread.key))
        expect(pending).toHaveLength(1)
        const proposal = settingsProposalSchema.parse(pending[0].args)
        expect(proposal.changes.map((change) => change.id).sort()).toEqual([
          'branding.dark.primary',
          'branding.light.primary',
          'branding.logoKey',
          'messenger.enabled',
        ])
        expect(
          proposal.changes
            .filter((change) => change.id.endsWith('.primary'))
            .map((change) => change.after)
        ).toEqual(['#0F766E', '#0F766E'])
        const logo = proposal.changes.find((change) => change.id === 'branding.logoKey')!
        expect(logo.before).toBeNull()
        expect(logo.after).toMatch(/^logos\/[a-f\d]{64}\.png$/)
        expect(logo.afterPreview).toMatch(/^\/api\/storage\/logos\//)
        ownedLogo = logo.after as string
        expect(JSON.stringify(proposal)).not.toContain('example.com')
        expect(proposal.changes.some((change) => change.path[0] === 'website')).toBe(false)
        const stored = await getS3Object(ownedLogo)
        expect(stored.contentType).toBe('image/png')
        expect((await new Response(stored.body).arrayBuffer()).byteLength).toBeGreaterThan(8)
        const applied = await applyWorkspaceSettingsProposal(
          seeded.actor,
          pending[0].id,
          proposal.changes.map((change) => change.id)
        )
        expect(applied.status).toBe('executed')
        const after = (await database.select().from(settings))[0]
        expect(after.logoKey).toBe(ownedLogo)
        expect(JSON.parse(after.brandingConfig!).light.primary).toBe('#0F766E')
        expect(JSON.parse(after.brandingConfig!).dark.primary).toBe('#0F766E')
        expect(JSON.parse(after.widgetConfig!).messenger.enabled).toBe(true)
        expect(
          await database.select().from(auditLog).where(eq(auditLog.targetId, pending[0].id))
        ).toHaveLength(1)
        await undoWorkspaceSettingsProposal(seeded.actor, pending[0].id)
        const restored = (await database.select().from(settings))[0]
        for (const column of JSON_COLUMNS)
          expect(JSON.parse(restored[column] ?? '{}'), column).toEqual(
            JSON.parse(before[column] ?? '{}')
          )
        for (const column of SCALAR_COLUMNS)
          expect(restored[column], column).toEqual(before[column])
        expect(
          await database.select().from(auditLog).where(eq(auditLog.targetId, pending[0].id))
        ).toHaveLength(2)
      } finally {
        if (ownedLogo) await deleteObject(ownedLogo)
      }
    })
  })
})
