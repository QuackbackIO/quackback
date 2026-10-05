import { describe, expect, it } from 'vitest'
import { accountDisplayName, greetingName, principalShownName, shownName } from '../greeting-name'

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

describe('shownName', () => {
  it('shows a name from the address for an account that signed in by email alone', () => {
    expect(shownName('', 'ana@northwind.test')).toBe('Ana')
    expect(shownName(null, 'ana@northwind.test')).toBe('Ana')
  })

  it('keeps a given name, and falls back to the address only when no name can be made', () => {
    expect(shownName('Ana Silva', 'ana@northwind.test')).toBe('Ana Silva')
    expect(shownName('', 'x1@northwind.test')).toBe('x1@northwind.test')
    expect(shownName(null, null)).toBe('')
  })
})

describe('principalShownName', () => {
  it('names an anonymous visitor by their generated name, never the account placeholder', () => {
    expect(
      principalShownName({
        type: 'anonymous',
        displayName: 'Snowy Cardinal',
        name: 'Anonymous',
        email: 'temp-abc@anon.example',
      })
    ).toBe('Snowy Cardinal')
  })

  it('gives no name for an anonymous visitor without a generated one', () => {
    expect(
      principalShownName({ type: 'anonymous', displayName: ' ', name: 'Anonymous', email: null })
    ).toBeNull()
  })

  it('names a person by the name they gave, else their email, else their principal name', () => {
    expect(
      principalShownName({ type: 'user', displayName: 'Old', name: 'Ana Silva', email: null })
    ).toBe('Ana Silva')
    expect(
      principalShownName({ type: 'user', displayName: null, name: '', email: 'ana@x.example' })
    ).toBe('Ana')
    expect(
      principalShownName({ type: 'user', displayName: 'Ana S', name: null, email: null })
    ).toBe('Ana S')
    expect(principalShownName({ type: null, displayName: null, name: null, email: null })).toBeNull()
  })
})
