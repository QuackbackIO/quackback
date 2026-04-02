import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '../version'

describe('isNewerVersion', () => {
  it('returns true when latest major is higher', () => {
    expect(isNewerVersion('0.4.5', '1.0.0')).toBe(true)
  })

  it('returns true when latest minor is higher', () => {
    expect(isNewerVersion('0.4.5', '0.5.0')).toBe(true)
  })

  it('returns true when latest patch is higher', () => {
    expect(isNewerVersion('0.4.5', '0.4.6')).toBe(true)
  })

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('0.4.5', '0.4.5')).toBe(false)
  })

  it('returns false when current is newer', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
  })

  it('returns false when latest minor is lower', () => {
    expect(isNewerVersion('0.5.0', '0.4.9')).toBe(false)
  })
})
