import { describe, it, expect } from 'vitest'
import { isAiClientConfigured, collectAiConfigWarnings } from '../config'

describe('isAiClientConfigured', () => {
  it('is true only when both api key and base url are set', () => {
    expect(isAiClientConfigured('sk-key', 'https://api.openai.com/v1')).toBe(true)
  })

  it('is false when base url is missing (no implicit api.openai.com)', () => {
    expect(isAiClientConfigured('sk-key', undefined)).toBe(false)
    expect(isAiClientConfigured('sk-key', '')).toBe(false)
  })

  it('is false when api key is missing', () => {
    expect(isAiClientConfigured(undefined, 'https://gateway.example/v1')).toBe(false)
  })
})

describe('collectAiConfigWarnings', () => {
  it('warns when api key is set but base url is missing', () => {
    const w = collectAiConfigWarnings({
      apiKey: 'sk',
      baseUrl: undefined,
      chatModel: undefined,
      embeddingModel: undefined,
    })
    expect(w.some((m) => m.includes('OPENAI_BASE_URL'))).toBe(true)
  })

  it('warns when client is configured but no models are set', () => {
    const w = collectAiConfigWarnings({
      apiKey: 'sk',
      baseUrl: 'https://x/v1',
      chatModel: undefined,
      embeddingModel: undefined,
    })
    expect(w.some((m) => m.includes('no models'))).toBe(true)
  })

  it('is silent when client and at least one model are configured', () => {
    const w = collectAiConfigWarnings({
      apiKey: 'sk',
      baseUrl: 'https://x/v1',
      chatModel: 'm',
      embeddingModel: undefined,
    })
    expect(w).toEqual([])
  })

  it('is silent when AI is entirely unconfigured', () => {
    const w = collectAiConfigWarnings({
      apiKey: undefined,
      baseUrl: undefined,
      chatModel: undefined,
      embeddingModel: undefined,
    })
    expect(w).toEqual([])
  })
})
