import { describe, it, expect } from 'vitest'
import {
  ACCESS_TIERS,
  ACCESS_TIER_RANK,
  DEFAULT_BOARD_ACCESS,
  type AccessTier,
  type BoardAccess,
} from '../types'

describe('AccessTier definitions', () => {
  it('contains exactly four tiers in ascending restriction order', () => {
    expect(ACCESS_TIERS).toEqual(['anonymous', 'authenticated', 'segments', 'team'])
  })

  it('rank reflects ascending restriction (anonymous = 0, team = 3)', () => {
    expect(ACCESS_TIER_RANK.anonymous).toBe(0)
    expect(ACCESS_TIER_RANK.authenticated).toBe(1)
    expect(ACCESS_TIER_RANK.segments).toBe(2)
    expect(ACCESS_TIER_RANK.team).toBe(3)
  })

  it('DEFAULT_BOARD_ACCESS preserves current public-board behavior', () => {
    // New boards continue to act like the current { kind: 'public' }: anon
    // can view, vote, comment, and submit; the workspace moderation default
    // is the fallback that the per-board 'inherit' rules resolve against.
    expect(DEFAULT_BOARD_ACCESS).toEqual({
      view: 'anonymous',
      vote: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    })
  })

  it('BoardAccess type is structurally exact (compile-time)', () => {
    const sample: BoardAccess = {
      view: 'anonymous' as AccessTier,
      vote: 'anonymous',
      comment: 'authenticated',
      submit: 'segments',
      segments: { view: [], vote: [], comment: [], submit: ['segment_alpha'] },
      moderation: { anonPosts: 'on', signedPosts: 'on', comments: 'inherit' },
    }
    expect(sample.view).toBe('anonymous')
  })
})
