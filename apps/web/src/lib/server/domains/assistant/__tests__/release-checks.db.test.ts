/**
 * The required checks and the candidate sandbox, against a real database
 * (QUINN-PRODUCT Step 10, P7).
 *
 * The sandbox cases are the ones worth the real database: a turn runs for real,
 * with a fake model but the real tool assembly, the real mode resolution and
 * the real persistence paths, and the assertions are about rows that were NOT
 * written. A sandbox that quietly opened a conversation, or ran a write tool
 * because the candidate dialled it to always, would be caught here rather than
 * in production.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantInvolvements,
  assistantToolCalls,
  conversationMessages,
  conversations,
  settings,
} from '@/lib/server/db'
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/shared/assistant/config'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
  aiChatModel: 'test-model' as string | undefined,
  aiSummaryModel: undefined,
  aiSentimentModel: undefined,
  aiExtractionModel: undefined,
  aiQualityGateModel: undefined,
  aiInterpretationModel: undefined,
  aiMergeModel: undefined,
  aiHelpCenterModel: undefined,
  aiEmbeddingModel: undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/ai')>()),
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: () => ({ kind: 'text' }),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  runCandidateSandboxTurn,
  runReleaseCheck,
  type CandidateBehaviour,
} from '../release-checks'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

function candidate(overrides: Partial<CandidateBehaviour> = {}): CandidateBehaviour {
  return {
    config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    configRevision: 1,
    workspaceName: 'Quackback',
    liveConfig: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    managedFieldPaths: [],
    ...overrides,
  }
}

/** One model turn that answers immediately, with no tool call. */
function answersPlainly(text = 'I can help with billing and access.') {
  mockChat.mockImplementation(() =>
    (async function* () {
      const object = { text, citations: [] }
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
      yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
      yield {
        type: 'RUN_FINISHED',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }
    })()
  )
}

describe.skipIf(!fixture.available)('release checks (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    mockConfig.aiChatModel = 'test-model'
    mockConfig.openaiApiKey = 'test-key'
    mockChat.mockReset()
    const existing = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing.length === 0) {
      await testDb.insert(settings).values({
        name: 'Check workspace',
        slug: `chk_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(),
      })
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('configuration', () => {
    it('passes a valid candidate', async () => {
      const outcome = await runReleaseCheck('configuration', candidate())
      expect(outcome.status).toBe('passed')
    })

    it('fails a candidate that does not parse', async () => {
      const broken = structuredClone(DEFAULT_ASSISTANT_CONFIG) as AssistantConfig
      ;(broken.agents.agent.voice as { tone: string }).tone = 'sardonic'
      const outcome = await runReleaseCheck('configuration', candidate({ config: broken }))
      expect(outcome.status).toBe('failed')
      expect(outcome.detail.issues).toContain('agents.agent.voice.tone')
    })

    it('fails a candidate that moves a setting the deployment manages', async () => {
      const next = structuredClone(DEFAULT_ASSISTANT_CONFIG)
      next.agents.agent.voice = { ...next.agents.agent.voice, tone: 'professional' }
      const outcome = await runReleaseCheck(
        'configuration',
        candidate({
          config: next,
          managedFieldPaths: ['assistant.agents.agent.voice.tone'],
        })
      )
      expect(outcome.status).toBe('failed')
      expect(outcome.detail.managedPaths).toEqual(['agents.agent.voice.tone'])
    })

    it('passes when the managed path is one the candidate did not touch', async () => {
      const next = structuredClone(DEFAULT_ASSISTANT_CONFIG)
      next.agents.agent.voice = { ...next.agents.agent.voice, tone: 'professional' }
      const outcome = await runReleaseCheck(
        'configuration',
        candidate({ config: next, managedFieldPaths: ['assistant.identity.name'] })
      )
      expect(outcome.status).toBe('passed')
    })
  })

  describe('toolset', () => {
    it('assembles both uses under the candidate and records what each got', async () => {
      const outcome = await runReleaseCheck('toolset', candidate())
      expect(outcome.status).toBe('passed')
      const tools = outcome.detail.tools as Record<string, string[]>
      expect(tools.agent.length).toBeGreaterThan(0)
      expect(tools.copilot.length).toBeGreaterThan(0)
    })

    it('names a rule that points at an action the candidate cannot offer', async () => {
      const next = structuredClone(DEFAULT_ASSISTANT_CONFIG)
      next.agents.agent.toolRules = { no_such_tool: 'allow' }
      const outcome = await runReleaseCheck('toolset', candidate({ config: next }))
      expect(outcome.status).toBe('passed')
      expect(outcome.detail.unmatchedRules).toEqual(['agent.no_such_tool'])
    })
  })

  describe('answer_sandbox', () => {
    it('records itself as skipped rather than passing when no model is configured', async () => {
      mockConfig.aiChatModel = undefined
      const outcome = await runReleaseCheck('answer_sandbox', candidate())
      expect(outcome.status).toBe('skipped')
      expect(outcome.detail.reason).toBe('no_model')
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('passes when the candidate answers a plain question', async () => {
      answersPlainly()
      const outcome = await runReleaseCheck('answer_sandbox', candidate())
      expect(outcome.status).toBe('passed')
    })
  })

  describe('the candidate sandbox', () => {
    it('answers under the exact candidate, not the live configuration', async () => {
      const frozen = structuredClone(DEFAULT_ASSISTANT_CONFIG)
      frozen.identity = { name: 'Candidate Quinn', avatarUrl: null }
      let systemPrompt = ''
      mockChat.mockImplementation((opts: { systemPrompts?: unknown }) => {
        systemPrompt = JSON.stringify(opts.systemPrompts ?? [])
        return (async function* () {
          const object = { text: 'Hello.', citations: [] }
          yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield {
            type: 'RUN_FINISHED',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          }
        })()
      })

      const turn = await runCandidateSandboxTurn({
        messages: [{ sender: 'customer', content: 'who are you?' }],
        candidate: candidate({ config: frozen }),
      })

      expect(turn.status).toBe('answered')
      expect(systemPrompt).toContain('Candidate Quinn')
    })

    it('writes no conversation, message, involvement or receipt', async () => {
      answersPlainly()
      const before = await counts()

      await runCandidateSandboxTurn({
        messages: [{ sender: 'customer', content: 'my invoice is wrong' }],
        candidate: candidate(),
      })

      expect(await counts()).toEqual(before)
    })

    it('never executes a write the candidate dialled to always', async () => {
      const dialled = structuredClone(DEFAULT_ASSISTANT_CONFIG)
      // `allow` is the dial that runs a write for real on a live turn. The
      // sandbox has to beat it, which is the ordering Step 7 fixed.
      dialled.agents.agent.toolRules = { create_ticket: 'allow' }
      const called: string[] = []
      mockChat.mockImplementation(
        (opts: {
          tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
          context: unknown
        }) =>
          (async function* () {
            for (const tool of opts.tools) {
              if (tool.name !== 'create_ticket') continue
              called.push(tool.name)
              await tool.execute(
                { type: 'customer', title: 'Invoice is wrong' },
                { context: opts.context, emitCustomEvent: () => {} }
              )
            }
            const object = { text: 'A teammate will follow up.', citations: [] }
            yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
            yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
            yield {
              type: 'RUN_FINISHED',
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            }
          })()
      )
      const before = await counts()

      const turn = await runCandidateSandboxTurn({
        messages: [{ sender: 'customer', content: 'I want a person' }],
        candidate: candidate({ config: dialled }),
      })

      expect(called).toEqual(['create_ticket'])
      // Previewed, not merely "not executed": a failed attempt here would mean
      // the write ran for real and could not finish.
      expect(turn.tools).toEqual([{ name: 'create_ticket', outcome: 'simulated' }])
      expect(turn.executedTools).toEqual([])
      expect(await counts()).toEqual(before)
    })
  })

  async function counts() {
    const rows = await Promise.all([
      testDb.select({ id: conversations.id }).from(conversations),
      testDb.select({ id: conversationMessages.id }).from(conversationMessages),
      testDb.select({ id: assistantInvolvements.id }).from(assistantInvolvements),
      testDb.select({ id: assistantToolCalls.id }).from(assistantToolCalls),
    ])
    return rows.map((rowset) => rowset.length)
  }
})
