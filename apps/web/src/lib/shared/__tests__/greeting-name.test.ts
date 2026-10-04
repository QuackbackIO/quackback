import { describe, expect, it } from 'vitest'
import { accountDisplayName, greetingName } from '../greeting-name'

describe('greetingName', () => {
  it('uses the first name', () => {
    expect(greetingName('Sam Rivera', 'sam@example.com')).toBe('Sam')
    expect(greetingName('  maría  ', null)).toBe('María')
  })

  it('never greets with an email address', () => {
    expect(greetingName('sam+rev1@northwind.test', 'sam+rev1@northwind.test')).toBe('Sam')
    expect(greetingName(null, 'sam+rev1@northwind.test')).toBe('Sam')
    expect(greetingName('', 'jordan.lee@example.com')).toBe('Jordan')
    expect(greetingName(undefined, 'alex42@example.com')).toBe('Alex')
  })

  it('gives up when nothing usable is left', () => {
    expect(greetingName(null, '1234@example.com')).toBeNull()
    expect(greetingName(null, 'j2@example.com')).toBeNull()
    expect(greetingName(null, null)).toBeNull()
    expect(greetingName('+@x', 'x@example.com')).toBeNull()
  })
})

describe('accountDisplayName', () => {
  it('keeps the whole name an account gave', () => {
    expect(accountDisplayName('Jane Doe', 'jane@northwind.test')).toBe('Jane Doe')
  })

  it('derives a name from the email when the account gave none', () => {
    expect(accountDisplayName('', 'sam.lee+t@northwind.test')).toBe('Sam')
    expect(accountDisplayName(null, 'sam@northwind.test')).toBe('Sam')
    expect(accountDisplayName('sam@northwind.test', null)).toBe('Sam')
  })

  it('gives null when nothing usable is left', () => {
    expect(accountDisplayName('', 'x1@northwind.test')).toBeNull()
  })
})
