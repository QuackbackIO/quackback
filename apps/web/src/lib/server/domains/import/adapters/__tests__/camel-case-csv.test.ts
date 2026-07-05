import { describe, it, expect } from 'vitest'
import { normalizeHeaderCamelCase, parseCsvCamelCase } from '../camel-case-csv'

describe('normalizeHeaderCamelCase', () => {
  it('normalizes various formats to camelCase', () => {
    expect(normalizeHeaderCamelCase('Idea Title')).toBe('ideaTitle')
    expect(normalizeHeaderCamelCase('idea_title')).toBe('ideaTitle')
    expect(normalizeHeaderCamelCase('IDEA-TITLE')).toBe('ideaTitle')
  })

  it('passes through an already-normalized header unchanged', () => {
    expect(normalizeHeaderCamelCase('ideaTitle')).toBe('ideaTitle')
    expect(normalizeHeaderCamelCase('votes')).toBe('votes')
  })
})

describe('parseCsvCamelCase', () => {
  it('parses headers and rows with camelCase normalization', () => {
    const csv = 'Idea Id,Idea Title\n1,Dark mode\n'
    const { headers, rows } = parseCsvCamelCase(csv)
    expect(headers).toEqual(['ideaId', 'ideaTitle'])
    expect(rows).toEqual([{ ideaId: '1', ideaTitle: 'Dark mode' }])
  })
})
