/**
 * Tests for quality gate service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
}

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => mockOpenAI),
  stripCodeFences: vi.fn((s: string) => s.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '')),
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) =>
    fn().then((result: unknown) => ({ result, retryCount: 0 }))
  ),
}))

vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: vi.fn((_params: unknown, fn: () => Promise<{ result: unknown }>) =>
    fn().then(({ result }) => result)
  ),
}))

vi.mock('../prompts/quality-gate.prompt', () => ({
  buildQualityGatePrompt: vi.fn(() => 'mocked prompt'),
}))

describe('quality-gate.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeItem = (text: string, sourceType = 'intercom') => ({
    sourceType,
    content: { text } as { subject?: string; text: string },
    context: {} as Record<string, unknown>,
  })

  it('should hard skip content with fewer than 5 words', async () => {
    const { shouldExtract } = await import('../quality-gate.service')
    const result = await shouldExtract(makeItem('ok thanks'))
    expect(result.extract).toBe(false)
    expect(result.tier).toBe(1)
    expect(result.reason).toContain('insufficient content')

    // Tier 1 skips should not call the LLM or usage logging
    const { withUsageLogging } = await import('@/lib/server/domains/ai/usage-log')
    expect(withUsageLogging).not.toHaveBeenCalled()
  })

  it('should hard skip empty content', async () => {
    const { shouldExtract } = await import('../quality-gate.service')
    const result = await shouldExtract(makeItem(''))
    expect(result.extract).toBe(false)
  })

  it('should auto-pass quackback source with 15+ words', async () => {
    const { shouldExtract } = await import('../quality-gate.service')
    const longText = 'word '.repeat(20).trim()
    const result = await shouldExtract(makeItem(longText, 'quackback'))
    expect(result.extract).toBe(true)
    expect(result.tier).toBe(2)
    expect(result.reason).toContain('high-intent')
    // Should not call LLM or usage logging
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    const { withUsageLogging } = await import('@/lib/server/domains/ai/usage-log')
    expect(withUsageLogging).not.toHaveBeenCalled()
  })

  it('should auto-pass api source with 15+ words', async () => {
    const { shouldExtract } = await import('../quality-gate.service')
    const longText = 'word '.repeat(20).trim()
    const result = await shouldExtract(makeItem(longText, 'api'))
    expect(result.extract).toBe(true)
    expect(result.reason).toContain('high-intent')
  })

  it('should NOT auto-pass intercom source with 15+ words', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"extract": true, "reason": "has feedback"}' } }],
    })

    const { shouldExtract } = await import('../quality-gate.service')
    const longText = 'word '.repeat(20).trim()
    const result = await shouldExtract(makeItem(longText, 'intercom'))
    // Should call LLM for intercom
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalled()
    expect(result.extract).toBe(true)
  })

  it('should return LLM gate result when extract=true', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"extract": true, "reason": "contains feedback"}' } }],
    })

    const { shouldExtract } = await import('../quality-gate.service')
    const result = await shouldExtract(
      makeItem('I really wish you would add dark mode to the app please', 'intercom')
    )
    expect(result.extract).toBe(true)
    expect(result.tier).toBe(3)
    expect(result.reason).toBe('contains feedback')

    const { withUsageLogging } = await import('@/lib/server/domains/ai/usage-log')
    expect(withUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'quality_gate',
        callType: 'chat_completion',
        model: expect.any(String),
        metadata: expect.objectContaining({ promptVersion: 'v1' }),
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('should return LLM gate result when extract=false', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"extract": false, "reason": "just a greeting"}' } }],
    })

    const { shouldExtract } = await import('../quality-gate.service')
    const result = await shouldExtract(
      makeItem('Hey there how are you doing today friend', 'intercom')
    )
    expect(result.extract).toBe(false)
    expect(result.tier).toBe(3)
    expect(result.reason).toBe('just a greeting')
  })

  it('should thread rawFeedbackItemId to usage logging', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"extract": true, "reason": "ok"}' } }],
    })

    const { shouldExtract } = await import('../quality-gate.service')
    await shouldExtract({
      ...makeItem('I really want this feature added to the app please', 'intercom'),
      rawFeedbackItemId: 'raw_item_abc',
    })

    const { withUsageLogging } = await import('@/lib/server/domains/ai/usage-log')
    expect(withUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'quality_gate',
        rawFeedbackItemId: 'raw_item_abc',
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('should pass through on LLM error', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API timeout'))

    const { shouldExtract } = await import('../quality-gate.service')
    const result = await shouldExtract(
      makeItem('I need the export feature to work better please fix it', 'intercom')
    )
    expect(result.extract).toBe(true)
    expect(result.reason).toContain('error')
  })

  it('should fall back to word count when AI not configured', async () => {
    const { getOpenAI } = await import('@/lib/server/domains/ai/config')
    vi.mocked(getOpenAI).mockReturnValueOnce(null)

    const { shouldExtract } = await import('../quality-gate.service')

    // 15+ words should pass
    const longResult = await shouldExtract(makeItem('word '.repeat(20).trim(), 'intercom'))
    expect(longResult.extract).toBe(true)

    vi.mocked(getOpenAI).mockReturnValueOnce(null)

    // <15 words but >=5 should fail
    const shortResult = await shouldExtract(
      makeItem('this is just seven words here total', 'intercom')
    )
    expect(shortResult.extract).toBe(false)
  })
})
