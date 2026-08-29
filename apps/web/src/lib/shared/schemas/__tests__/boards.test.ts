import { describe, it, expect } from 'vitest'
import { accessForPreset, normalizeBoardAccess, presetForAccess } from '../boards'

describe('accessForPreset', () => {
  it('public preset: view=anonymous, vote/comment/submit=authenticated, segments empty, moderation all inherit', () => {
    const a = accessForPreset('public')
    expect(a.view).toBe('anonymous')
    expect(a.vote).toBe('authenticated')
    expect(a.comment).toBe('authenticated')
    expect(a.submit).toBe('authenticated')
    expect(a.segments).toEqual({ view: [], vote: [], comment: [], submit: [] })
    expect(a.moderation).toEqual({
      anonPosts: 'inherit',
      signedPosts: 'inherit',
      comments: 'inherit',
    })
  })

  it('private preset: all actions=team', () => {
    const a = accessForPreset('private')
    expect(a.view).toBe('team')
    expect(a.vote).toBe('team')
    expect(a.comment).toBe('team')
    expect(a.submit).toBe('team')
    expect(a.segments).toEqual({ view: [], vote: [], comment: [], submit: [] })
    expect(a.moderation).toEqual({
      anonPosts: 'inherit',
      signedPosts: 'inherit',
      comments: 'inherit',
    })
  })
})

describe('presetForAccess', () => {
  it('returns public for the public preset matrix', () => {
    expect(presetForAccess(accessForPreset('public'))).toBe('public')
  })

  it('returns private for the private preset matrix', () => {
    expect(presetForAccess(accessForPreset('private'))).toBe('private')
  })

  it('returns custom when any action tier differs from both presets', () => {
    const access = accessForPreset('public')
    expect(presetForAccess({ ...access, submit: 'team' })).toBe('custom')
  })

  it('returns custom when public tiers have a non-empty segment list', () => {
    const access = accessForPreset('public')
    expect(
      presetForAccess({
        ...access,
        segments: { ...access.segments, view: ['seg_customers'] },
      })
    ).toBe('custom')
  })

  it('returns custom when private tiers have a non-empty segment list', () => {
    const access = accessForPreset('private')
    expect(
      presetForAccess({
        ...access,
        segments: { ...access.segments, submit: ['seg_beta'] },
      })
    ).toBe('custom')
  })

  it('ignores moderation when classifying a preset', () => {
    const access = accessForPreset('public')
    expect(
      presetForAccess({
        ...access,
        moderation: { anonPosts: 'on', signedPosts: 'off', comments: 'on' },
      })
    ).toBe('public')
  })
})

describe('normalizeBoardAccess', () => {
  it('fills leftover view+submit rows with inherit moderation', () => {
    const a = normalizeBoardAccess({ view: 'anonymous', submit: 'authenticated' })
    expect(a.vote).toBe('authenticated')
    expect(a.comment).toBe('authenticated')
    expect(a.segments).toEqual({ view: [], vote: [], comment: [], submit: [] })
    expect(a.moderation).toEqual({
      anonPosts: 'inherit',
      signedPosts: 'inherit',
      comments: 'inherit',
    })
  })
})
