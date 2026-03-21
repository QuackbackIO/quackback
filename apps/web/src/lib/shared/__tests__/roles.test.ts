import { describe, it, expect } from 'vitest'
import { isTeamMember, isAdmin } from '../roles'

describe('isTeamMember', () => {
  it('returns true for admin', () => {
    expect(isTeamMember('admin')).toBe(true)
  })

  it('returns true for member', () => {
    expect(isTeamMember('member')).toBe(true)
  })

  it('returns false for other strings', () => {
    expect(isTeamMember('viewer')).toBe(false)
    expect(isTeamMember('user')).toBe(false)
    expect(isTeamMember('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTeamMember(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTeamMember(undefined)).toBe(false)
  })
})

describe('isAdmin', () => {
  it('returns true for admin', () => {
    expect(isAdmin('admin')).toBe(true)
  })

  it('returns false for member', () => {
    expect(isAdmin('member')).toBe(false)
  })

  it('returns false for other strings', () => {
    expect(isAdmin('viewer')).toBe(false)
    expect(isAdmin('user')).toBe(false)
    expect(isAdmin('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdmin(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isAdmin(undefined)).toBe(false)
  })
})
