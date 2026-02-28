/**
 * Tests for extraction service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RawFeedbackItemId, FeedbackSignalId } from '@quackback/ids'

// --- Mock tracking ---
const updateSetCalls: unknown[][] = []
const insertValuesCalls: unknown[][] = []
const deleteWhereCalls: unknown[][] = []

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockResolvedValue([])
  return chain
}

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.returning = vi
    .fn()
    .mockResolvedValue([
      { id: 'signal_1' as FeedbackSignalId },
      { id: 'signal_2' as FeedbackSignalId },
    ])
  return chain
}

function createDeleteChain() {
  const chain: Record<string, unknown> = {}
  chain.where = vi.fn((...args: unknown[]) => {
    deleteWhereCalls.push(args)
    return Promise.resolve([])
  })
  return chain
}

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      rawFeedbackItems: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
    update: vi.fn(() => createUpdateChain()),
    insert: vi.fn(() => createInsertChain()),
    delete: vi.fn(() => createDeleteChain()),
  },
  eq: vi.fn(),
  rawFeedbackItems: {
    id: 'id',
    processingState: 'processing_state',
    attemptCount: 'attempt_count',
  },
  feedbackSignals: {
    id: 'id',
    rawFeedbackItemId: 'raw_feedback_item_id',
  },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
}

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => mockOpenAI),
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

vi.mock('../prompts/extraction.prompt', () => ({
  buildExtractionPrompt: vi.fn(() => 'mocked extraction prompt'),
}))

const mockShouldExtract = vi.fn()
vi.mock('../quality-gate.service', () => ({
  shouldExtract: (...args: unknown[]) => mockShouldExtract(...args),
}))

const mockEnqueue = vi.fn()
vi.mock('../../queues/feedback-ai-queue', () => ({
  enqueueFeedbackAiJob: (...args: unknown[]) => mockEnqueue(...args),
}))

describe('extraction.service', () => {
  beforeEach(() => {
    updateSetCalls.length = 0
    insertValuesCalls.length = 0
    deleteWhereCalls.length = 0
    vi.clearAllMocks()
  })

  const rawItemId = 'raw_item_123' as RawFeedbackItemId

  const mockItem = {
    id: rawItemId,
    processingState: 'ready_for_extraction',
    sourceType: 'intercom',
    content: { subject: 'CSV Export', text: 'We need CSV export' },
    contextEnvelope: {},
  }

  it('should extract signals and enqueue interpret jobs', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: true, reason: 'ok' })
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              signals: [
                {
                  signalType: 'feature_request',
                  summary: 'CSV export needed',
                  evidence: ['We need CSV export'],
                  confidence: 0.9,
                },
                {
                  signalType: 'usability_issue',
                  summary: 'Data portability',
                  evidence: ['export data'],
                  confidence: 0.7,
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    // Should insert 2 signals
    expect(insertValuesCalls.length).toBe(1)
    const signalValues = insertValuesCalls[0][0] as unknown[]
    expect(signalValues).toHaveLength(2)

    // Should enqueue 2 interpret jobs
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
  })

  it('should skip when quality gate rejects', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: false, reason: 'not feedback' })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    // Should not call LLM
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    // Should mark as completed
    expect(updateSetCalls.length).toBeGreaterThanOrEqual(2)
    const lastSet = updateSetCalls[updateSetCalls.length - 1][0] as Record<string, unknown>
    expect(lastSet.processingState).toBe('completed')
  })

  it('should throw UnrecoverableError when item not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null)

    const { extractSignals } = await import('../extraction.service')
    await expect(extractSignals(rawItemId)).rejects.toThrow('not found')
  })

  it('should skip when item is in wrong state', async () => {
    mockFindFirst.mockResolvedValueOnce({ ...mockItem, processingState: 'completed' })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    // Should not update state
    expect(updateSetCalls.length).toBe(0)
  })

  it('should filter low-confidence signals', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: true, reason: 'ok' })
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              signals: [
                { signalType: 'feature_request', summary: 'high', evidence: [], confidence: 0.8 },
                { signalType: 'question', summary: 'low', evidence: [], confidence: 0.3 },
              ],
            }),
          },
        },
      ],
      usage: {},
    })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    // Only high-confidence signal should be inserted
    const signalValues = insertValuesCalls[0][0] as unknown[]
    expect(signalValues).toHaveLength(1)
  })

  it('should limit to 5 signals max', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: true, reason: 'ok' })
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              signals: Array.from({ length: 7 }, (_, i) => ({
                signalType: 'feature_request',
                summary: `signal ${i}`,
                evidence: [],
                confidence: 0.9,
              })),
            }),
          },
        },
      ],
      usage: {},
    })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    const signalValues = insertValuesCalls[0][0] as unknown[]
    expect(signalValues).toHaveLength(5)
  })

  it('should parse JSON wrapped in code fences', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: true, reason: 'ok' })
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '```json\n' +
              JSON.stringify({
                signals: [
                  { signalType: 'bug_report', summary: 'test', evidence: [], confidence: 0.8 },
                ],
              }) +
              '\n```',
          },
        },
      ],
      usage: {},
    })

    const { extractSignals } = await import('../extraction.service')
    await extractSignals(rawItemId)

    expect(insertValuesCalls.length).toBe(1)
  })

  it('should mark as failed on LLM error', async () => {
    mockFindFirst.mockResolvedValueOnce(mockItem)
    mockShouldExtract.mockResolvedValueOnce({ extract: true, reason: 'ok' })
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API error'))

    const { extractSignals } = await import('../extraction.service')
    await expect(extractSignals(rawItemId)).rejects.toThrow('API error')

    // Should set state to failed
    const failedSet = updateSetCalls.find(
      (call) => (call[0] as Record<string, unknown>).processingState === 'failed'
    )
    expect(failedSet).toBeDefined()
  })

  it('should throw when AI not configured', async () => {
    const { getOpenAI } = await import('@/lib/server/domains/ai/config')
    vi.mocked(getOpenAI).mockReturnValueOnce(null)

    const { extractSignals } = await import('../extraction.service')
    await expect(extractSignals(rawItemId)).rejects.toThrow('not configured')
  })
})
