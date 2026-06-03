import { describe, it, expect } from 'vitest'
import { accessForPreset } from '../boards'

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
