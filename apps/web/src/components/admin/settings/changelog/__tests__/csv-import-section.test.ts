import { describe, it, expect } from 'vitest'
import { parseEmailsFromCsv } from '../csv-import-section'

describe('parseEmailsFromCsv', () => {
  it('extracts the Email column by header name (case-insensitive)', () => {
    const csv = 'Name,Email\nAlice,alice@example.com\nBob,bob@example.com'
    expect(parseEmailsFromCsv(csv)).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('finds the Email column regardless of position', () => {
    const csv = 'email,name\nalice@example.com,Alice\nbob@example.com,Bob'
    expect(parseEmailsFromCsv(csv)).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('falls back to treating every line as an email when no header matches', () => {
    const csv = 'alice@example.com\nbob@example.com'
    expect(parseEmailsFromCsv(csv)).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('ignores blank lines', () => {
    const csv = 'Email\nalice@example.com\n\nbob@example.com\n'
    expect(parseEmailsFromCsv(csv)).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('returns an empty array for empty input', () => {
    expect(parseEmailsFromCsv('')).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const csv = 'Email\r\nalice@example.com\r\nbob@example.com'
    expect(parseEmailsFromCsv(csv)).toEqual(['alice@example.com', 'bob@example.com'])
  })
})
