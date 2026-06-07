import { describe, it, expect } from 'vitest'
import { resolveModel } from '../models'

describe('resolveModel', () => {
  it('returns the override when set', () => {
    expect(resolveModel('gpt-4o-mini', 'role-default')).toBe('gpt-4o-mini')
  })

  it('falls back to the role default when override is unset', () => {
    expect(resolveModel(undefined, 'role-default')).toBe('role-default')
  })

  it('returns null when neither override nor role default is set', () => {
    expect(resolveModel(undefined, undefined)).toBeNull()
  })

  it('treats off/none/false override as disabled even when role default is set', () => {
    expect(resolveModel('off', 'role-default')).toBeNull()
    expect(resolveModel('none', 'role-default')).toBeNull()
    expect(resolveModel('false', 'role-default')).toBeNull()
  })

  it('matches the disable sentinel case-insensitively and trimmed', () => {
    expect(resolveModel('  OFF ', 'role-default')).toBeNull()
    expect(resolveModel('None', 'role-default')).toBeNull()
  })

  it('does not treat a normal model id as disabled', () => {
    expect(resolveModel('google/gemini-3.1-flash-lite-preview', undefined)).toBe(
      'google/gemini-3.1-flash-lite-preview'
    )
  })
})
