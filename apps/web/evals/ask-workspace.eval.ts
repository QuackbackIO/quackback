import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ASK_GOLDEN_CASES, ASK_OPERATOR_GOLDEN_CASE } from '@/lib/server/mcp/evals/ask-golden'
import { createAskMcpFixture } from '@/lib/server/mcp/evals/ask-mcp-fixture'
import { seedAskGoldenFixture } from '@/lib/server/mcp/evals/ask-golden-fixtures'
import { openAskSdkHarness } from '@/lib/server/mcp/evals/ask-sdk-harness'
import {
  runAssistantTurn,
  isAssistantConfigured,
} from '@/lib/server/domains/assistant/assistant.runtime'
import { settings, eq, principal, assistantPendingActions } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import {
  settingsProposalSchema,
  settingsProposalInputSchema,
} from '@/lib/shared/assistant/settings-proposals'
import { prepareSettingsChanges } from '@/lib/server/domains/assistant/settings-proposals.service'

let fixture: Awaited<ReturnType<typeof createAskMcpFixture>>
beforeAll(async () => {
  if (!isAssistantConfigured())
    throw new Error(
      'Ask model evaluations require a configured real assistant model. SDK contract tests run separately without a model.'
    )
  fixture = await createAskMcpFixture()
}, 180_000)
afterAll(async () => {
  await fixture?.close()
})

/** Real configured model, real MCP discovery/transport, real permission and proposal stores. */
describe('Ask workspace model golden selection', () => {
  it.each([...ASK_GOLDEN_CASES, ASK_OPERATOR_GOLDEN_CASE])('$id $request', async (scenario) => {
    await fixture.run(async (database) => {
      const seeded = await seedAskGoldenFixture(
        database,
        scenario.profile,
        scenario.tool === 'navigate_workspace',
        scenario.operatorManagedName
      )
      // Discover the same real first-party catalogue through the SDK before each model turn.
      const sdk = await openAskSdkHarness(seeded.auth)
      try {
        const catalogue = await sdk.client.listTools()
        expect(catalogue.tools.map((tool) => tool.name)).toContain(scenario.tool)
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
      // Observe the real SDK calls; the spy forwards every request to the actual transport.
      const toolCalls = vi.spyOn(Client.prototype, 'callTool')
      let result: Awaited<ReturnType<typeof runAssistantTurn>>
      let observedCalls: Array<{ name: string; arguments?: Record<string, unknown> }>
      try {
        result = await runAssistantTurn({
          role: 'workspace_assistant',
          surface: 'workspace',
          actor: seeded.actor,
          actorPrincipalId: seeded.actor.principalId,
          assistantPrincipalId: assistantId,
          workspaceThreadKey: seeded.thread.key,
          latestCustomerMessageId: `golden-${scenario.id}`,
          messages: [{ sender: 'customer', content: scenario.request }],
          db: database,
          signal: AbortSignal.timeout(120_000),
        })
        observedCalls = toolCalls.mock.calls.map(([call]) => call)
      } finally {
        toolCalls.mockRestore()
      }
      const after = (
        await database.select().from(settings).where(eq(settings.id, seeded.workspace.id))
      )[0]
      expect(after).toEqual(before)
      expect(result.status).not.toBe('suppressed')
      if (result.status === 'suppressed') throw new Error('Model turn was suppressed')
      if (scenario.id === '02' || scenario.operatorManagedName) {
        expect(observedCalls[0]).toMatchObject({
          name: 'get_settings',
          arguments: { area: 'portal' },
        })
        const readIndex = result.trace.toolCalls.findIndex((call) => call.name === 'get_settings')
        const nextIndex = result.trace.toolCalls.findIndex((call) => call.name === scenario.tool)
        expect(
          readIndex,
          JSON.stringify({ observedCalls, text: result.text, calls: result.trace.toolCalls })
        ).toBeGreaterThanOrEqual(0)
        expect(nextIndex).toBeGreaterThan(readIndex)
      }
      if (scenario.operatorManagedName) {
        expect(result.trace.toolCalls.map((call) => call.name)).not.toContain(
          'propose_settings_change'
        )
        expect(await database.select().from(assistantPendingActions)).toEqual([])
      }
      const controlTools = new Set(['use_skill', 'report_inability'])
      expect(
        result.trace.toolCalls.filter(
          (call) => call.outcome === 'executed' && !controlTools.has(call.name)
        ),
        JSON.stringify({ text: result.text, calls: result.trace.toolCalls })
      ).toEqual([])
      if (scenario.expected === 'denied') {
        expect(result.proposedActions).toEqual([])
        if (scenario.denialReason === 'unavailable') {
          expect(result.trace.toolCalls.map((call) => call.name)).toContain(scenario.tool)
          expect(result.navigation ?? []).toEqual([])
          expect(result.text).toMatch(/unavailable|not available|isn[’']t available|not enabled/i)
        } else {
          expect(result.text).toMatch(/owner|admin/i)
        }
      } else {
        expect(
          result.trace.toolCalls.map((call) => call.name),
          JSON.stringify({
            text: result.text,
            calls: result.trace.toolCalls.map(({ name, outcome }) => ({ name, outcome })),
            navigation: result.navigation,
          })
        ).toContain(scenario.tool)
        if (scenario.expected === 'navigation') {
          expect(result.navigation).toContainEqual(
            expect.objectContaining({ href: scenario.expectedHref })
          )
          expect(result.proposedActions).toEqual([])
        } else if (scenario.expected === 'proposal') {
          const pending = await database
            .select()
            .from(assistantPendingActions)
            .where(eq(assistantPendingActions.workspaceThreadKey, seeded.thread.key))
          expect(pending).toHaveLength(1)
          const proposal = settingsProposalSchema.parse(pending[0].args)
          expect([...new Set(proposal.changes.map((change) => change.area))].sort()).toEqual(
            [...scenario.expectedAreas!].sort()
          )
          expect([...proposal.changes].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
            [...expectedProposal!.changes].sort((a, b) => a.id.localeCompare(b.id))
          )
        }
      }
    })
  })
})
