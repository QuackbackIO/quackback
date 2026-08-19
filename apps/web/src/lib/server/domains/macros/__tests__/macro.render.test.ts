import { describe, it, expect } from 'vitest'
import { renderMacro } from '../macro.render'

describe('renderMacro', () => {
  it('substitutes the known variables', () => {
    expect(
      renderMacro('Hi {firstName} {lastName}, we emailed {email} about "{conversationTitle}"', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        conversationTitle: 'Login help',
      })
    ).toBe('Hi Ada Lovelace, we emailed ada@example.com about "Login help"')
  })

  it('renders unknown variables as empty string', () => {
    expect(renderMacro('Hello {mystery}!', {})).toBe('Hello !')
  })

  it('renders missing/null known values as empty string', () => {
    expect(renderMacro('Hi {firstName}{lastName}', { firstName: 'Ada', lastName: null })).toBe(
      'Hi Ada'
    )
    expect(renderMacro('Hi {firstName}', {})).toBe('Hi ')
  })

  it('leaves text without placeholders untouched', () => {
    expect(renderMacro('No variables here.', { firstName: 'Ada' })).toBe('No variables here.')
  })

  it('replaces every occurrence of a repeated variable', () => {
    expect(renderMacro('{firstName} {firstName}', { firstName: 'Ada' })).toBe('Ada Ada')
  })
})
