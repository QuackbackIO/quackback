/**
 * Tests for string utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  getInitials,
  normalizeStrength,
  strengthTier,
  formatBadgeCount,
  stripHtml,
  truncate,
  formatStatus,
  getStatusEmoji,
  slugify,
} from '../string'

describe('getInitials', () => {
  it('returns initials from two-word name', () => {
    expect(getInitials('John Doe')).toBe('JD')
  })

  it('returns single initial from one-word name', () => {
    expect(getInitials('Alice')).toBe('A')
  })

  it('limits to 2 characters for long names', () => {
    expect(getInitials('John Michael Doe')).toBe('JM')
  })

  it('uppercases lowercase input', () => {
    expect(getInitials('jane doe')).toBe('JD')
  })

  it('returns ? for null', () => {
    expect(getInitials(null)).toBe('?')
  })

  it('returns ? for undefined', () => {
    expect(getInitials(undefined)).toBe('?')
  })

  it('returns ? for empty string', () => {
    expect(getInitials('')).toBe('?')
  })
})

describe('normalizeStrength', () => {
  it('returns 0 for zero input', () => {
    expect(normalizeStrength(0)).toBe(0)
  })

  it('returns 0 for negative input', () => {
    expect(normalizeStrength(-5)).toBe(0)
  })

  it('returns 0 for NaN', () => {
    expect(normalizeStrength(NaN)).toBe(0)
  })

  it('returns 0 for Infinity', () => {
    expect(normalizeStrength(Infinity)).toBe(0)
  })

  it('returns 0 for negative Infinity', () => {
    expect(normalizeStrength(-Infinity)).toBe(0)
  })

  it('normalizes small values to low scores', () => {
    const result = normalizeStrength(1)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(5)
  })

  it('normalizes raw ~10 to approximately 8', () => {
    const result = normalizeStrength(10)
    expect(result).toBeGreaterThanOrEqual(7)
    expect(result).toBeLessThanOrEqual(9)
  })

  it('caps at 10', () => {
    expect(normalizeStrength(1000)).toBe(10)
  })

  it('returns one decimal place', () => {
    const result = normalizeStrength(3)
    const decimals = String(result).split('.')[1]
    expect(!decimals || decimals.length <= 1).toBe(true)
  })
})

describe('strengthTier', () => {
  it('returns low for 0', () => {
    expect(strengthTier(0)).toBe('low')
  })

  it('returns low for 2', () => {
    expect(strengthTier(2)).toBe('low')
  })

  it('returns medium for 2.1', () => {
    expect(strengthTier(2.1)).toBe('medium')
  })

  it('returns medium for 5', () => {
    expect(strengthTier(5)).toBe('medium')
  })

  it('returns high for 5.1', () => {
    expect(strengthTier(5.1)).toBe('high')
  })

  it('returns high for 8', () => {
    expect(strengthTier(8)).toBe('high')
  })

  it('returns critical for 8.1', () => {
    expect(strengthTier(8.1)).toBe('critical')
  })

  it('returns critical for 10', () => {
    expect(strengthTier(10)).toBe('critical')
  })
})

describe('formatBadgeCount', () => {
  it('returns number as string for small values', () => {
    expect(formatBadgeCount(5)).toBe('5')
  })

  it('returns number as string for 99', () => {
    expect(formatBadgeCount(99)).toBe('99')
  })

  it('returns 99+ for 100', () => {
    expect(formatBadgeCount(100)).toBe('99+')
  })

  it('returns 99+ for large values', () => {
    expect(formatBadgeCount(999)).toBe('99+')
  })

  it('returns 0 as string', () => {
    expect(formatBadgeCount(0)).toBe('0')
  })
})

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('returns plain text unchanged', () => {
    expect(stripHtml('No tags here')).toBe('No tags here')
  })

  it('decodes &nbsp;', () => {
    expect(stripHtml('hello&nbsp;world')).toBe('hello world')
  })

  it('decodes &amp;', () => {
    expect(stripHtml('A&amp;B')).toBe('A&B')
  })

  it('decodes &lt; and &gt;', () => {
    expect(stripHtml('&lt;div&gt;')).toBe('<div>')
  })

  it('decodes &quot;', () => {
    expect(stripHtml('say &quot;hi&quot;')).toBe('say "hi"')
  })

  it('decodes &#39;', () => {
    expect(stripHtml('it&#39;s')).toBe("it's")
  })

  it('normalizes whitespace', () => {
    expect(stripHtml('hello   \n  world')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  <p>hello</p>  ')).toBe('hello')
  })

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('')
  })

  it('handles complex HTML', () => {
    expect(stripHtml('<div class="foo"><p>Hello</p><br/><p>World</p></div>')).toBe('HelloWorld')
  })
})

describe('slugify', () => {
  it('slugifies basic Latin text', () => {
    expect(slugify('Feature Requests')).toBe('feature-requests')
  })

  it('handles Cyrillic text', () => {
    expect(slugify('Кириллица')).toBe('kirillica')
  })

  it('handles mixed Latin and Cyrillic', () => {
    const result = slugify('Board Кириллица')
    expect(result).toContain('board')
    expect(result.length).toBeGreaterThan('board-'.length)
  })

  it('handles special characters', () => {
    expect(slugify('Feature & Requests!')).toBe('feature-and-requests')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  hello world  ')).toBe('hello-world')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('handles German umlauts', () => {
    expect(slugify('Über uns')).toBe('uber-uns')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('a---b')).toBe('a-b')
  })
})

describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('short', 10)).toBe('short')
  })

  it('returns text unchanged at exact limit', () => {
    expect(truncate('exact', 5)).toBe('exact')
  })

  it('truncates with ellipsis when over limit', () => {
    expect(truncate('this is a long string', 10)).toBe('this is...')
  })

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('')
  })
})

describe('formatStatus', () => {
  it('formats underscore-separated status', () => {
    expect(formatStatus('in_progress')).toBe('In Progress')
  })

  it('formats single word', () => {
    expect(formatStatus('open')).toBe('Open')
  })

  it('formats already capitalized input', () => {
    expect(formatStatus('UNDER_REVIEW')).toBe('Under Review')
  })

  it('handles space-separated input', () => {
    expect(formatStatus('in progress')).toBe('In Progress')
  })
})

describe('getStatusEmoji', () => {
  it('returns correct emoji for known statuses', () => {
    expect(getStatusEmoji('open')).toBe('\ud83d\udce5')
    expect(getStatusEmoji('complete')).toBe('\u2705')
    expect(getStatusEmoji('closed')).toBe('\ud83d\udd12')
  })

  it('handles case-insensitive input', () => {
    expect(getStatusEmoji('IN_PROGRESS')).toBe('\ud83d\udea7')
  })

  it('handles space-separated input', () => {
    expect(getStatusEmoji('under review')).toBe('\ud83d\udc40')
  })

  it('returns fallback emoji for unknown status', () => {
    expect(getStatusEmoji('unknown')).toBe('\ud83d\udccc')
  })
})
