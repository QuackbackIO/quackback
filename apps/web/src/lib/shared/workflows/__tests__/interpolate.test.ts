import { describe, it, expect } from 'vitest'
import { interpolate, interpolateTiptapContent } from '../interpolate'

describe('interpolate', () => {
  it('passes text with no tokens through unchanged', () => {
    expect(interpolate('Hello, thanks for reaching out!', {})).toBe(
      'Hello, thanks for reaching out!'
    )
  })

  it('substitutes a resolved value verbatim', () => {
    expect(interpolate('Hi {first_name}!', { first_name: 'Jane' })).toBe('Hi Jane!')
  })

  it('substitutes the fallback when the value is missing (key absent)', () => {
    expect(interpolate('Hi {first_name|there}!', {})).toBe('Hi there!')
  })

  it('substitutes the fallback when the value is undefined', () => {
    expect(interpolate('Hi {first_name|there}!', { first_name: undefined })).toBe('Hi there!')
  })

  it('substitutes the fallback when the value is null', () => {
    expect(interpolate('Hi {first_name|there}!', { first_name: null })).toBe('Hi there!')
  })

  it('substitutes the fallback when the value is an empty string', () => {
    expect(interpolate('Hi {first_name|there}!', { first_name: '' })).toBe('Hi there!')
  })

  it('substitutes empty string for a missing value with no fallback', () => {
    expect(interpolate('Hi {first_name}, welcome', {})).toBe('Hi , welcome')
  })

  it('substitutes empty string for an explicit empty value with no fallback', () => {
    expect(interpolate('Hi {first_name}, welcome', { first_name: '' })).toBe('Hi , welcome')
  })

  it('never leaves a raw token in the output', () => {
    const result = interpolate('Hi {first_name}, {unknown_token} welcome', {})
    expect(result).not.toContain('{')
    expect(result).not.toContain('}')
  })

  it('treats an unknown token name like a missing value with its fallback', () => {
    expect(interpolate('{does_not_exist|Customer}', {})).toBe('Customer')
  })

  it('treats an unknown token name with no fallback as empty string', () => {
    expect(interpolate('[{does_not_exist}]', {})).toBe('[]')
  })

  it('resolves adjacent tokens independently', () => {
    expect(interpolate('{first_name}{last_name}', { first_name: 'Jane', last_name: 'Doe' })).toBe(
      'JaneDoe'
    )
  })

  it('resolves adjacent tokens where one is missing', () => {
    expect(interpolate('{first_name}{last_name|Doe}', { first_name: 'Jane' })).toBe('JaneDoe')
  })

  it('allows spaces and punctuation in fallback text', () => {
    expect(interpolate('{name|Hi there, friend!}', {})).toBe('Hi there, friend!')
  })

  it('treats an explicit empty fallback as empty string', () => {
    expect(interpolate('[{first_name|}]', {})).toBe('[]')
  })

  it('renders a literal brace pair via the doubled-brace escape', () => {
    expect(interpolate('Use {{first_name}} as a literal example', {})).toBe(
      'Use {first_name} as a literal example'
    )
  })

  it('renders standalone doubled braces as single literal braces', () => {
    expect(interpolate('{{ and }}', {})).toBe('{ and }')
  })

  it('does not re-interpolate a value that itself looks like a token', () => {
    expect(interpolate('{first_name}', { first_name: '{last_name}' })).toBe('{last_name}')
  })

  it('leaves an unmatched stray brace untouched', () => {
    expect(interpolate('a { b } c', {})).toBe('a { b } c')
  })

  it('resolves multiple distinct tokens in one template', () => {
    expect(
      interpolate('Hi {first_name|there}, welcome to {workspace_name}!', {
        first_name: 'Jane',
        workspace_name: 'Acme',
      })
    ).toBe('Hi Jane, welcome to Acme!')
  })
})

describe('interpolateTiptapContent', () => {
  it('interpolates a single text node', () => {
    const doc = { type: 'doc', content: [{ type: 'text', text: 'Hi {first_name}!' }] }
    expect(interpolateTiptapContent(doc, { first_name: 'Jane' })).toEqual({
      type: 'doc',
      content: [{ type: 'text', text: 'Hi Jane!' }],
    })
  })

  it('interpolates each text node independently across nested nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi {first_name}, ' },
            { type: 'text', text: 'welcome to {workspace_name}.', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    const resolved = interpolateTiptapContent(doc, { first_name: 'Jane', workspace_name: 'Acme' })
    expect(resolved).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi Jane, ' },
            { type: 'text', text: 'welcome to Acme.', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
  })

  it('leaves a non-text, non-container node (e.g. an image) unchanged', () => {
    const doc = { type: 'image', attrs: { src: 'https://example.com/x.png' } }
    expect(interpolateTiptapContent(doc, {})).toEqual(doc)
  })

  it('never leaves a raw token in the resolved doc', () => {
    const doc = { type: 'doc', content: [{ type: 'text', text: 'Hi {unknown_token}!' }] }
    const resolved = interpolateTiptapContent(doc, {})
    expect(JSON.stringify(resolved)).not.toContain('{unknown_token}')
  })

  it('does not mutate the input doc', () => {
    const doc = { type: 'doc', content: [{ type: 'text', text: 'Hi {first_name}!' }] }
    const original = JSON.parse(JSON.stringify(doc))
    interpolateTiptapContent(doc, { first_name: 'Jane' })
    expect(doc).toEqual(original)
  })
})
