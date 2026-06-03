import { describe, it, expect } from 'vitest'
import { boardAccessSchema } from '../boards'
import { accessForPreset } from '@/lib/shared/schemas/boards'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const baseValid = {
  view: 'anonymous' as const,
  vote: 'anonymous' as const,
  comment: 'anonymous' as const,
  submit: 'anonymous' as const,
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
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

  it('accepts segments tier with non-empty per-action segments', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: ['seg_a'], vote: ['seg_a'], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).not.toThrow()
  })

  it('accepts segments tier on just comment/submit (view stays anonymous, only those lists required)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'segments',
        submit: 'segments',
        segments: { view: [], vote: [], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).not.toThrow()
  })

  it('accepts mixed per-action segment lists (view picks pro; submit picks beta)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: {
          view: ['seg_pro'],
          vote: ['seg_pro'],
          comment: ['seg_pro'],
          submit: ['seg_beta'],
        },
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
        vote: 'segments',
        comment: 'anonymous',
        submit: 'segments',
        segments: { view: ['seg_a'], vote: ['seg_a'], comment: [], submit: ['seg_a'] },
      })
    ).toThrow(/comment/i)
  })
})

describe('boardAccessSchema — segments invariant', () => {
  it('rejects segments tier with all per-action lists empty', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: [], vote: [], comment: [], submit: [] },
      })
    ).toThrow(/segment/i)
  })

  it('rejects when only one of the three tiers is segments and that action list is empty', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'segments',
        segments: { view: [], vote: [], comment: [], submit: [] },
      })
    ).toThrow(/segment/i)
  })

  it('rejects when comment is segments and only comment list is empty (per-action enforcement)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: ['seg_a'], vote: ['seg_a'], comment: [], submit: ['seg_a'] },
      })
    ).toThrow(/segment/i)
  })

  it('caps each per-action segment list at 50', () => {
    const fifty1 = Array.from({ length: 51 }, (_, i) => `seg_${i}`)
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: fifty1, vote: ['seg_a'], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).toThrow(/50/)
  })
})

describe('boardAccessSchema — vote action invariants', () => {
  it('rejects vote tier below view tier (would let denied viewers vote)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'authenticated',
        vote: 'anonymous',
      })
    ).toThrow(/vote/i)
  })

  it('accepts vote tier stricter than view tier (modern "Public": view=anonymous, vote=authenticated)', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'anonymous',
        vote: 'authenticated',
      })
    ).not.toThrow()
  })

  it('rejects when vote is segments and the vote list is empty', () => {
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: ['seg_a'], vote: [], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).toThrow(/vote/i)
  })
})

describe('boardAccessSchema — tier enum invariants', () => {
  it('rejects unknown tier name', () => {
    expect(() => boardAccessSchema.parse({ ...baseValid, view: 'admin' as never })).toThrow()
  })
})

// ----------------------------------------------------------------------
// Audit gap-fill — the spec requires that the preset outputs and the
// column default actually PARSE through the validator that gates every
// write (not just that their field values look right), plus the cap
// boundary and the view-only segments rejection.
// ----------------------------------------------------------------------

describe('boardAccessSchema — preset + default consistency', () => {
  it("accessForPreset('public') passes the schema (view=anonymous, vote/comment/submit=authenticated)", () => {
    expect(() => boardAccessSchema.parse(accessForPreset('public'))).not.toThrow()
  })

  it("accessForPreset('private') passes the schema (all-team, equal top-tier ranks accepted)", () => {
    expect(() => boardAccessSchema.parse(accessForPreset('private'))).not.toThrow()
  })

  it('DEFAULT_BOARD_ACCESS passes the schema (the column default must be internally consistent)', () => {
    expect(() => boardAccessSchema.parse(DEFAULT_BOARD_ACCESS)).not.toThrow()
  })
})

describe('boardAccessSchema — boundary + isolation cases', () => {
  it('accepts exactly 50 segments in a per-action list (cap boundary, guards .max(50) → .max(49))', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `seg_${i}`)
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: fifty, vote: ['seg_a'], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).not.toThrow()
  })

  it('rejects view=segments with an empty segments.view list (isolates the view action)', () => {
    // Existing tests isolate vote/comment/submit empty-list rejection; this
    // pins the view action specifically — an empty view allowlist would hide
    // the board from everyone.
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: [], vote: ['seg_a'], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).toThrow(/view/i)
  })

  it('accepts vote=team while view=anonymous (maximal vote-above-view gap)', () => {
    expect(() =>
      boardAccessSchema.parse({ ...baseValid, view: 'anonymous', vote: 'team' })
    ).not.toThrow()
  })

  it('CHARACTERIZATION: an empty-string segment id is currently accepted (count-only check)', () => {
    // The schema constrains list COUNT and non-emptiness, not element content.
    // If a z.string().min(1) tightening is later added, flip this to .toThrow
    // so the change is deliberate and test-backed.
    expect(() =>
      boardAccessSchema.parse({
        ...baseValid,
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: { view: [''], vote: ['seg_a'], comment: ['seg_a'], submit: ['seg_a'] },
      })
    ).not.toThrow()
  })
})
