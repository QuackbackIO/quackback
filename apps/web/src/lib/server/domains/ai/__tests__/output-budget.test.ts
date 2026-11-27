import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  openaiBaseUrl: undefined as string | undefined,
  aiMaxTokensParam: undefined as string | undefined,
  aiReasoningEffort: undefined as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { outputBudgetOptions, outputTokenParam, REASONING_HEADROOM_TOKENS } from '../output-budget'

beforeEach(() => {
  mockConfig.openaiBaseUrl = undefined
  mockConfig.aiMaxTokensParam = undefined
  mockConfig.aiReasoningEffort = undefined
})

describe('outputTokenParam', () => {
  it('uses max_completion_tokens for the OpenAI API', () => {
    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1'
    expect(outputTokenParam()).toBe('max_completion_tokens')
  })

  it.each([
    'https://openrouter.ai/api/v1',
    'http://localhost:11434/v1',
    'https://gateway.example/v1',
    'https://api.openai.com.evil.example/v1',
    'not a url',
    undefined,
  ])('keeps max_tokens for %s', (baseUrl) => {
    mockConfig.openaiBaseUrl = baseUrl
    expect(outputTokenParam()).toBe('max_tokens')
  })

  it('follows AI_MAX_TOKENS_PARAM in either direction', () => {
    mockConfig.openaiBaseUrl = 'https://gateway.example/v1'
    mockConfig.aiMaxTokensParam = ' MAX_COMPLETION_TOKENS '
    expect(outputTokenParam()).toBe('max_completion_tokens')

    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1'
    mockConfig.aiMaxTokensParam = 'max_tokens'
    expect(outputTokenParam()).toBe('max_tokens')
  })

  it('ignores an unknown AI_MAX_TOKENS_PARAM value', () => {
    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1'
    mockConfig.aiMaxTokensParam = 'max_output_tokens'
    expect(outputTokenParam()).toBe('max_completion_tokens')
  })
})

describe('outputBudgetOptions', () => {
  it('sends the cap unchanged as max_tokens off OpenAI', () => {
    mockConfig.openaiBaseUrl = 'https://openrouter.ai/api/v1'
    mockConfig.aiReasoningEffort = 'low'
    expect(outputBudgetOptions(400)).toEqual({ max_tokens: 400 })
  })

  it('adds reasoning headroom to max_completion_tokens', () => {
    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1'
    expect(outputBudgetOptions(100)).toEqual({
      max_completion_tokens: 100 + REASONING_HEADROOM_TOKENS,
    })
  })

  it('never sends reasoning_effort, even with AI_REASONING_EFFORT set', () => {
    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1'
    mockConfig.aiReasoningEffort = 'low'
    expect(outputBudgetOptions(100)).toEqual({
      max_completion_tokens: 100 + REASONING_HEADROOM_TOKENS,
    })
  })
})
