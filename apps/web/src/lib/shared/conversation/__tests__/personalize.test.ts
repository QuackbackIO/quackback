import { describe, it, expect } from 'vitest'
import { personalizeMessage } from '../personalize'

describe('personalizeMessage', () => {
  it('substitutes {{first_name}} with the visitor first name', () => {
    expect(personalizeMessage('Hi {{first_name}}! 👋', 'Jane')).toBe('Hi Jane! 👋')
  })

  it('falls back to "there" when the name is missing', () => {
    expect(personalizeMessage('Hi {{first_name}}! 👋', null)).toBe('Hi there! 👋')
    expect(personalizeMessage('Hi {{first_name}}!', '   ')).toBe('Hi there!')
    expect(personalizeMessage('Hi {{first_name}}!', undefined)).toBe('Hi there!')
  })

  it('trims the supplied name', () => {
    expect(personalizeMessage('Hi {{first_name}}!', '  Jane  ')).toBe('Hi Jane!')
  })

  it('replaces every occurrence and tolerates inner whitespace', () => {
    expect(personalizeMessage('{{first_name}}, hi {{ first_name }}', 'Sam')).toBe('Sam, hi Sam')
  })

  it('leaves a template without the token unchanged', () => {
    expect(personalizeMessage('Hello! How can we help?', 'Jane')).toBe('Hello! How can we help?')
  })

  it('honours a custom fallback', () => {
    expect(personalizeMessage('Hi {{first_name}}!', null, 'friend')).toBe('Hi friend!')
  })
})
