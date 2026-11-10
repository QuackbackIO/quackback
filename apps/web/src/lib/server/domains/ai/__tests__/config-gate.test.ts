import { describe, it, expect } from 'vitest'
import { collectAiConfigWarnings } from '../config'
import { resolveAiProvider, type AiProviderEnv } from '../provider'

const none: AiProviderEnv = {
  openaiApiKey: undefined,
  openaiBaseUrl: undefined,
  anthropicApiKey: undefined,
}

describe('resolveAiProvider: exactly one provider', () => {
  it('is the OpenAI-compatible endpoint when its key and base url are set', () => {
    expect(
      resolveAiProvider({ ...none, openaiApiKey: 'sk-key', openaiBaseUrl: 'https://x/v1' })
    ).toEqual({ provider: 'openai', issue: null })
  })

  it('is off when the OpenAI base url is missing (no implicit api.openai.com)', () => {
    expect(resolveAiProvider({ ...none, openaiApiKey: 'sk-key' })).toEqual({
      provider: null,
      issue: 'openai-base-url-missing',
    })
    expect(resolveAiProvider({ ...none, openaiApiKey: 'sk-key', openaiBaseUrl: '' }).provider).toBe(
      null
    )
  })

  it('is off when only a base url is set', () => {
    expect(resolveAiProvider({ ...none, openaiBaseUrl: 'https://gateway.example/v1' })).toEqual({
      provider: null,
      issue: null,
    })
  })

  it('is the Claude API when only ANTHROPIC_API_KEY is set, with or without a base url', () => {
    expect(resolveAiProvider({ ...none, anthropicApiKey: 'sk-ant' })).toEqual({
      provider: 'anthropic',
      issue: null,
    })
    expect(
      resolveAiProvider({ ...none, anthropicApiKey: 'sk-ant', openaiBaseUrl: 'https://x/v1' })
        .provider
    ).toBe('anthropic')
  })

  it('turns AI off when both keys are set, with the reason', () => {
    expect(
      resolveAiProvider({
        openaiApiKey: 'sk',
        openaiBaseUrl: 'https://x/v1',
        anthropicApiKey: 'sk-ant',
      })
    ).toEqual({ provider: null, issue: 'multiple-providers' })
  })

  it('is off when nothing is set', () => {
    expect(resolveAiProvider(none)).toEqual({ provider: null, issue: null })
  })
})

describe('collectAiConfigWarnings', () => {
  const snap = (over: Partial<Parameters<typeof collectAiConfigWarnings>[0]>) => ({
    ...none,
    chatModel: undefined,
    embeddingModel: undefined,
    ...over,
  })

  it('warns when api key is set but base url is missing', () => {
    const w = collectAiConfigWarnings(snap({ openaiApiKey: 'sk' }))
    expect(w.some((m) => m.includes('OPENAI_BASE_URL'))).toBe(true)
  })

  it('warns when client is configured but no models are set', () => {
    const w = collectAiConfigWarnings(snap({ openaiApiKey: 'sk', openaiBaseUrl: 'https://x/v1' }))
    expect(w.some((m) => m.includes('no models'))).toBe(true)
  })

  it('is silent when client and at least one model are configured', () => {
    const w = collectAiConfigWarnings(
      snap({ openaiApiKey: 'sk', openaiBaseUrl: 'https://x/v1', chatModel: 'm' })
    )
    expect(w).toEqual([])
  })

  it('is silent when AI is entirely unconfigured', () => {
    expect(collectAiConfigWarnings(snap({}))).toEqual([])
  })

  it('says AI is disabled, and why, when both providers are configured', () => {
    const w = collectAiConfigWarnings(
      snap({
        openaiApiKey: 'sk',
        openaiBaseUrl: 'https://x/v1',
        anthropicApiKey: 'sk-ant',
        chatModel: 'm',
      })
    )
    expect(w).toEqual([
      'AI disabled: both OPENAI_API_KEY and ANTHROPIC_API_KEY are set. Configure exactly one AI provider and remove the other key.',
    ])
  })

  it('on the Claude API needs no model (Haiku 5.5 is the default) and states embeddings are off', () => {
    const w = collectAiConfigWarnings(snap({ anthropicApiKey: 'sk-ant' }))
    expect(w.some((m) => m.includes('no models'))).toBe(false)
    expect(w.some((m) => m.startsWith('Embeddings are unavailable on the Claude API'))).toBe(true)
  })

  it('flags gateway-style model ids under the Claude API', () => {
    const w = collectAiConfigWarnings(
      snap({
        anthropicApiKey: 'sk-ant',
        chatModel: 'openai/gpt-6-luna:floor',
        featureModels: ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
      })
    )
    const msg = w.find((m) => m.includes('gateway model ids'))
    expect(msg).toContain('openai/gpt-6-luna:floor, anthropic/claude-haiku-5.5')
    expect(msg).not.toContain(', claude-haiku-5-5')
  })
})
