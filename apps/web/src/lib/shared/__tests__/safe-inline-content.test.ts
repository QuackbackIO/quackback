import { describe, expect, it } from 'vitest'
import { escapeInlineStyle, serializeJsonForHtml } from '../safe-inline-content'

describe('safe inline content', () => {
  it('makes style-element breakout text inert', () => {
    expect(escapeInlineStyle('</style><script>alert(1)</script>')).not.toContain('<')
  })

  it('makes JSON-LD script breakout text inert without changing parsed data', () => {
    const value = { title: '</script><img src=x onerror=alert(1)>', ampersand: 'a&b' }
    const serialized = serializeJsonForHtml(value)

    expect(serialized).not.toContain('<')
    expect(serialized).not.toContain('>')
    expect(serialized).not.toContain('&')
    expect(JSON.parse(serialized)).toEqual(value)
  })
})
