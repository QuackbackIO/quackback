import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { PrincipalId } from '@quackback/ids'
import { extractMentions, extractMentionExcerpts } from '../extract-mentions'

const doc = (content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const para = (...children: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  content: children,
})
const text = (t: string): JSONContent => ({ type: 'text', text: t })
const mention = (id: string, label: string): JSONContent => ({
  type: 'mention',
  attrs: { id, label },
})

describe('extractMentions', () => {
  it('returns empty set for empty doc', () => {
    expect(extractMentions(doc([]))).toEqual(new Set())
  })

  it('returns empty set for doc with no mentions', () => {
    expect(extractMentions(doc([para(text('hello world'))]))).toEqual(new Set())
  })

  it('extracts a single mention', () => {
    const tree = doc([para(text('hi '), mention('principal_abc', 'Jane'))])
    expect(extractMentions(tree)).toEqual(new Set(['principal_abc']))
  })

  it('extracts mentions from nested nodes (list items, blockquotes)', () => {
    const tree = doc([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [para(mention('principal_abc', 'A')), para(mention('principal_xyz', 'X'))],
          },
        ],
      },
    ])
    expect(extractMentions(tree)).toEqual(new Set(['principal_abc', 'principal_xyz']))
  })

  it('dedupes repeated mentions of the same principal', () => {
    const tree = doc([
      para(mention('principal_abc', 'Jane')),
      para(mention('principal_abc', 'Jane')),
    ])
    expect(extractMentions(tree)).toEqual(new Set(['principal_abc']))
  })

  it('handles null/undefined content gracefully', () => {
    expect(extractMentions(null as unknown as JSONContent)).toEqual(new Set())
    expect(extractMentions(undefined as unknown as JSONContent)).toEqual(new Set())
  })

  it('ignores mention nodes missing an attrs.id', () => {
    const tree = doc([para({ type: 'mention', attrs: { label: 'orphan' } } as JSONContent)])
    expect(extractMentions(tree)).toEqual(new Set())
  })
})

describe('extractMentionExcerpts', () => {
  it('returns the paragraph text for each mention', () => {
    const tree = doc([
      para(text('Hey '), mention('principal_a', 'A'), text(', take a look.')),
      para(text('Different paragraph.')),
    ])
    const out = extractMentionExcerpts(tree)
    expect(out.get('principal_a' as PrincipalId)).toBe('Hey , take a look.')
  })

  it('respects maxLen', () => {
    const long = 'a'.repeat(500)
    const tree = doc([para(text(long), mention('principal_a', 'A'))])
    const out = extractMentionExcerpts(tree, 50)
    expect(out.get('principal_a' as PrincipalId)?.length).toBeLessThanOrEqual(50)
  })

  it('returns empty map for content with no mentions', () => {
    const tree = doc([para(text('plain text'))])
    expect(extractMentionExcerpts(tree)).toEqual(new Map())
  })

  it('handles null/undefined content gracefully', () => {
    expect(extractMentionExcerpts(null)).toEqual(new Map())
    expect(extractMentionExcerpts(undefined)).toEqual(new Map())
  })

  it('first occurrence wins when same principal mentioned in multiple paragraphs', () => {
    const tree = doc([
      para(text('first '), mention('principal_a', 'A')),
      para(text('second '), mention('principal_a', 'A')),
    ])
    const out = extractMentionExcerpts(tree)
    expect(out.get('principal_a' as PrincipalId)).toBe('first')
  })
})
