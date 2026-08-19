import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  runSynthesis: vi.fn(),
  getChatModel: vi.fn<() => string | null>(() => 'quality-model'),
}))

vi.mock('../synthesis-core', () => ({
  runSynthesis: hoisted.runSynthesis,
  salvageJsonWithSchema: vi.fn(),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: hoisted.getChatModel }))

import {
  selectApplicableGuidance,
  splitGuidanceCandidates,
  type GuidanceSelectorCandidate,
} from '../guidance-selector'

function candidate(
  id: string,
  priority: number,
  overrides: Partial<GuidanceSelectorCandidate & { instruction: string }> = {}
) {
  return {
    id,
    name: `Rule ${id}`,
    appliesWhen: `When ${id} applies`,
    priority,
    createdAt: new Date(`2026-01-${String(priority + 1).padStart(2, '0')}T00:00:00.000Z`),
    instruction: `Private instruction for ${id}`,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getChatModel.mockReturnValue('quality-model')
  hoisted.runSynthesis.mockResolvedValue({ outcome: 'success', final: { ruleIds: [] } })
})

describe('splitGuidanceCandidates', () => {
  it('splits null always-on guidance from conditional guidance', () => {
    const always = candidate('always', 0, { appliesWhen: null })
    const conditional = candidate('conditional', 1)
    expect(splitGuidanceCandidates([always, conditional])).toEqual({
      alwaysOn: [always],
      conditional: [conditional],
    })
  })
})

describe('selectApplicableGuidance', () => {
  it('sends bounded context and only candidate IDs, names, and conditions with no tools', async () => {
    const candidates = [candidate('a', 0), candidate('b', 1)]
    const conversation = Array.from({ length: 10 }, (_, index) => ({
      sender: 'customer' as const,
      content: `${index}-${'x'.repeat(5_000)}`,
    }))
    await selectApplicableGuidance({
      candidates,
      latestRequest: 'r'.repeat(5_000),
      recentConversation: conversation,
    })

    const options = hoisted.runSynthesis.mock.calls[0][0]
    expect(options.tools).toBeNull()
    const payload = JSON.parse(options.messages[0].content)
    expect(payload.latestRequest).toHaveLength(4_000)
    expect(payload.recentConversation).toHaveLength(8)
    expect(payload.recentConversation[0].content).toHaveLength(4_000)
    expect(payload.candidates).toEqual([
      { id: 'a', name: 'Rule a', appliesWhen: 'When a applies' },
      { id: 'b', name: 'Rule b', appliesWhen: 'When b applies' },
    ])
    expect(options.messages[0].content).not.toContain('Private instruction')
  })

  it('intersects, deduplicates, caps at five, and restores priority order', async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => candidate(String(index), index))
    hoisted.runSynthesis.mockResolvedValue({
      outcome: 'success',
      final: { ruleIds: ['6', 'unknown', '4', '4', '3', '2', '1', '0', '5'] },
    })

    await expect(
      selectApplicableGuidance({ candidates, latestRequest: 'Help', recentConversation: [] })
    ).resolves.toEqual(['0', '1', '2', '3', '4'])
  })

  it('does not call the selector for always-on-only input', async () => {
    await expect(
      selectApplicableGuidance({
        candidates: [candidate('always', 0, { appliesWhen: null })],
        latestRequest: 'Help',
        recentConversation: [],
      })
    ).resolves.toEqual([])
    expect(hoisted.runSynthesis).not.toHaveBeenCalled()
  })

  it('returns no conditional guidance on provider failure or timeout', async () => {
    hoisted.runSynthesis.mockRejectedValueOnce(new Error('provider failed'))
    await expect(
      selectApplicableGuidance({
        candidates: [candidate('a', 0)],
        latestRequest: 'Help',
        recentConversation: [],
      })
    ).resolves.toEqual([])

    hoisted.runSynthesis.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    await expect(
      selectApplicableGuidance({
        candidates: [candidate('a', 0)],
        latestRequest: 'Help',
        recentConversation: [],
        timeoutMs: 1,
      })
    ).resolves.toEqual([])
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    hoisted.runSynthesis.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
    )
    const selection = selectApplicableGuidance({
      candidates: [candidate('a', 0)],
      latestRequest: 'Help',
      recentConversation: [],
      signal: controller.signal,
    })
    controller.abort()
    await expect(selection).rejects.toThrow('cancelled')
  })

  it('fails closed when the quality-gate model is disabled', async () => {
    hoisted.getChatModel.mockReturnValue(null)
    await expect(
      selectApplicableGuidance({
        candidates: [candidate('a', 0)],
        latestRequest: 'Help',
        recentConversation: [],
      })
    ).resolves.toEqual([])
    expect(hoisted.runSynthesis).not.toHaveBeenCalled()
  })
})
