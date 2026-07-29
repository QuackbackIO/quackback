import { describe, it, expect } from 'vitest'
import { keywordInContext, splitByTerms } from '../keyword-context'

/** The concatenated segment text, i.e. the excerpt as the row reads it. */
const excerpt = (segments: { text: string }[] | null) =>
  segments === null ? null : segments.map((s) => s.text).join('')

/** Just the highlighted runs. */
const marks = (segments: { text: string; match: boolean }[] | null) =>
  segments === null ? null : segments.filter((s) => s.match).map((s) => s.text)

describe('splitByTerms', () => {
  it('marks case-insensitive occurrences of every term', () => {
    expect(splitByTerms('Invite your Team today', 'team invite')).toEqual([
      { text: 'Invite', match: true },
      { text: ' your ', match: false },
      { text: 'Team', match: true },
      { text: ' today', match: false },
    ])
  })

  it('treats a term with regex metacharacters as literal text', () => {
    expect(splitByTerms('a+b equals c', 'a+b (')).toEqual([
      { text: 'a+b', match: true },
      { text: ' equals c', match: false },
    ])
  })
})

describe('keywordInContext', () => {
  it('centres the excerpt on the match and highlights it', () => {
    const segments = keywordInContext('We cannot export the invoice as a PDF.', 'invoice')
    expect(marks(segments)).toEqual(['invoice'])
    expect(excerpt(segments)).toBe('We cannot export the invoice as a PDF.')
  })

  it('keeps the match visible in a long body, ellipsing what it trimmed', () => {
    const body = `${'padding word '.repeat(40)}the refund never arrived ${'trailing word '.repeat(40)}`
    const segments = keywordInContext(body, 'refund')
    const text = excerpt(segments)!
    expect(text).toContain('the refund never arrived')
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(marks(segments)).toEqual(['refund'])
  })

  it('does not ellipse an excerpt that already spans the whole body', () => {
    const text = excerpt(keywordInContext('Short body about billing.', 'billing'))
    expect(text).toBe('Short body about billing.')
  })

  it('flattens markdown and newlines so the excerpt reads as one line', () => {
    const text = excerpt(keywordInContext('## Heading\n\n- **SAML** login is broken', 'saml'))
    expect(text).toBe('Heading SAML login is broken')
  })

  it('starts the excerpt on a word boundary, never mid-word', () => {
    const body = `${'x'.repeat(30)} alpha beta gamma delta the webhook retried twice`
    const text = excerpt(keywordInContext(body, 'webhook', { lead: 12 }))!
    expect(text).toBe('…delta the webhook retried twice')
  })

  it('returns null when the term is absent, empty, or the body is empty', () => {
    expect(keywordInContext('nothing to see here', 'invoice')).toBeNull()
    expect(keywordInContext('nothing to see here', '   ')).toBeNull()
    expect(keywordInContext('', 'invoice')).toBeNull()
  })
})
