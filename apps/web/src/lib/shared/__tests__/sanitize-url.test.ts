import { describe, expect, it } from 'vitest'
import { sanitizeUrl } from '../utils/sanitize'

describe('sanitizeUrl', () => {
  it.each(['/hc/en', '#setup', '../guide', '?page=2', '//help.example.com/guide'])(
    'preserves the relative reference %s',
    (url) => expect(sanitizeUrl(url)).toBe(url)
  )
  it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,bad', 'vbscript:bad'])(
    'rejects executable URLs %s',
    (url) => expect(sanitizeUrl(url)).toBe('')
  )
  it('normalizes absolute links and trims surrounding whitespace', () => {
    expect(sanitizeUrl(' https://example.com ')).toBe('https://example.com/')
    expect(sanitizeUrl(' #setup ')).toBe('#setup')
    expect(sanitizeUrl('mailto:help@example.com')).toBe('mailto:help@example.com')
  })
})
