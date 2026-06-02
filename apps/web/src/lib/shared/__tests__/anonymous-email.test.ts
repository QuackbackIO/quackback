import { describe, it, expect } from 'vitest'
import { ANON_EMAIL_DOMAIN, isSyntheticAnonEmail, realEmail } from '../anonymous-email'

describe('anonymous email', () => {
  const synthetic = `temp-ni7j5mnendrdtsjwbesk4mubz4jzszhj@${ANON_EMAIL_DOMAIN}`

  it('recognizes the synthetic anonymous placeholder', () => {
    expect(isSyntheticAnonEmail(synthetic)).toBe(true)
    expect(isSyntheticAnonEmail('jane@example.com')).toBe(false)
    expect(isSyntheticAnonEmail(null)).toBe(false)
    expect(isSyntheticAnonEmail(undefined)).toBe(false)
  })

  it('matches the domain case-insensitively', () => {
    expect(isSyntheticAnonEmail(`temp-abc@ANON.QUACKBACK.IO`)).toBe(true)
  })

  it('does not match a lookalike domain', () => {
    expect(isSyntheticAnonEmail('real@notanon.quackback.io.evil.com')).toBe(false)
  })

  it('realEmail returns null for synthetic / empty and the address otherwise', () => {
    expect(realEmail(synthetic)).toBeNull()
    expect(realEmail(null)).toBeNull()
    expect(realEmail(undefined)).toBeNull()
    expect(realEmail('')).toBeNull()
    expect(realEmail('jane@example.com')).toBe('jane@example.com')
  })
})
