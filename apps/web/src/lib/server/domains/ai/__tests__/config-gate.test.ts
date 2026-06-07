import { describe, it, expect } from 'vitest'
import { isAiClientConfigured } from '../config'

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
