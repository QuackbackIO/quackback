/**
 * T10: Pure `audienceToAccess` derivation, used by createBoard to keep the
 * additive `access` column consistent with the legacy `audience` field on
 * insert. Mirrors the 0079 migration backfill: each action lands on the
 * tier that matches the legacy kind, approval defaults to off, and the
 * segment list is preserved for kind='segments'.
 */
import { describe, it, expect } from 'vitest'
import { audienceToAccess } from '../board.service'
import { DEFAULT_BOARD_ACCESS } from '@/lib/server/db'

describe('audienceToAccess derivation', () => {
  it('public audience → all anonymous tiers', () => {
    expect(audienceToAccess({ kind: 'public' })).toEqual({
      ...DEFAULT_BOARD_ACCESS,
      view: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
    })
  })

  it('authenticated audience → all authenticated tiers', () => {
    expect(audienceToAccess({ kind: 'authenticated' })).toEqual({
      ...DEFAULT_BOARD_ACCESS,
      view: 'authenticated',
      comment: 'authenticated',
      submit: 'authenticated',
    })
  })

  it('team audience → all team tiers', () => {
    expect(audienceToAccess({ kind: 'team' })).toEqual({
      ...DEFAULT_BOARD_ACCESS,
      view: 'team',
      comment: 'team',
      submit: 'team',
    })
  })

  it('segments audience preserves segment ids', () => {
    expect(audienceToAccess({ kind: 'segments', segmentIds: ['seg_a', 'seg_b'] })).toEqual({
      ...DEFAULT_BOARD_ACCESS,
      view: 'segments',
      comment: 'segments',
      submit: 'segments',
      segmentIds: ['seg_a', 'seg_b'],
    })
  })
})
