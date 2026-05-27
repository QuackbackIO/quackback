import { describe, it, expect } from 'vitest'
import { boardAccessSchema } from '../boards'

const baseValid = {
  view: 'anonymous' as const,
  comment: 'anonymous' as const,
  submit: 'anonymous' as const,
  segmentIds: [],
  approval: { posts: false, comments: false },
}

describe('boardAccessSchema — valid shapes', () => {
  it('accepts the default-equivalent shape', () => {
    expect(() => boardAccessSchema.parse(baseValid)).not.toThrow()
  })

  it('accepts comment tier above view tier', () => {
    expect(() =>
      boardAccessSchema.parse({ ...baseValid, view: 'anonymous', comment: 'authenticated' })
    ).not.toThrow()
  })

  it('accepts submit tier above view tier (admin-curated)', () => {
    expect(() =>
      boardAccessSchema.parse({ ...baseValid, view: 'anonymous', submit: 'team' })
    ).not.toThrow()
  })

  it('accepts segments tier with non-empty segmentIds', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        comment: 'segments',
        submit: 'segments',
        segmentIds: ['seg_a'],
      })
    ).not.toThrow()
  })

  it('accepts segments tier on just comment/submit (view stays anonymous)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'anonymous',
        comment: 'segments',
        submit: 'segments',
        segmentIds: ['seg_a'],
      })
    ).not.toThrow()
  })
})

describe('boardAccessSchema — tier rank invariants', () => {
  it('rejects comment tier below view tier (would let users comment on invisible boards)', () => {
    expect(() =>
      boardAccessSchema.parse({ ...baseValid, view: 'authenticated', comment: 'anonymous' })
    ).toThrow(/comment/i)
  })

  it('rejects submit tier below view tier', () => {
    expect(() =>
      boardAccessSchema.parse({ ...baseValid, view: 'authenticated', submit: 'anonymous' })
    ).toThrow(/submit/i)
  })

  it('rejects view=segments comment=anonymous (rank inversion)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        comment: 'anonymous',
        submit: 'segments',
        segmentIds: ['seg_a'],
      })
    ).toThrow(/comment/i)
  })
})

describe('boardAccessSchema — segments invariant', () => {
  it('rejects segments tier with empty segmentIds', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        comment: 'segments',
        submit: 'segments',
        segmentIds: [],
      })
    ).toThrow(/segment/i)
  })

  it('rejects when only one of the three tiers is segments and segmentIds is empty', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'anonymous',
        comment: 'anonymous',
        submit: 'segments',
        segmentIds: [],
      })
    ).toThrow(/segment/i)
  })

  it('caps segmentIds at 50', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        comment: 'segments',
        submit: 'segments',
        segmentIds: Array.from({ length: 51 }, (_, i) => `seg_${i}`),
      })
    ).toThrow(/50/)
  })
})

describe('boardAccessSchema — tier enum invariants', () => {
  it('rejects unknown tier name', () => {
    expect(() => boardAccessSchema.parse({ ...baseValid, view: 'admin' as never })).toThrow()
  })
})
