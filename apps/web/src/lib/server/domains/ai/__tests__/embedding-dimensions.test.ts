import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../config', () => ({ embeddingZeroPadEnabled: () => false }))
vi.mock('@/lib/server/logger', () => {
  const log = { info: () => {}, warn: () => {}, error: hoisted.error, debug: () => {}, child: () => log }
  return { logger: log }
})

import { fitEmbeddingDimensions, padEmbedding } from '../embedding-dimensions'

const ctx = { model: 'm', pipelineStep: 'test' }
const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0)
  const n = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return dot / (n(a) * n(b))
}

describe('fitEmbeddingDimensions', () => {
  it('passes a vector of the right width through untouched', () => {
    const v = [0.1, 0.2, 0.3]
    expect(fitEmbeddingDimensions(v, 3, ctx)).toBe(v)
  })

  it('refuses a narrower vector unless padding is enabled', () => {
    expect(fitEmbeddingDimensions([1, 2], 4, ctx, false)).toBeNull()
    expect(hoisted.error).toHaveBeenCalled()
    expect(fitEmbeddingDimensions([1, 2], 4, ctx, true)).toEqual([1, 2, 0, 0])
  })

  it('always refuses a wider vector', () => {
    expect(fitEmbeddingDimensions([1, 2, 3], 2, ctx, true)).toBeNull()
  })

  it('returns null for a missing vector', () => {
    expect(fitEmbeddingDimensions(undefined, 3, ctx, true)).toBeNull()
  })

  it('keeps cosine similarity exactly after padding', () => {
    const a = [0.3, -0.2, 0.9]
    const b = [0.1, 0.4, 0.5]
    expect(cosine(padEmbedding(a, 8), padEmbedding(b, 8))).toBeCloseTo(cosine(a, b), 12)
  })
})
