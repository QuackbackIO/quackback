import { describe, it, expect } from 'vitest'
import { getAuthorName, buildPostUrl, escapeHtml, getErrorMessage } from '../message-utils'

describe('getAuthorName', () => {
  it('returns authorName when present', () => {
    expect(getAuthorName({ authorName: 'Alice', authorEmail: 'alice@test.com' })).toBe('Alice')
  })

  it('falls back to authorEmail when authorName is null', () => {
    expect(getAuthorName({ authorName: null, authorEmail: 'alice@test.com' })).toBe(
      'alice@test.com'
    )
  })

  it('falls back to authorEmail when authorName is empty string', () => {
    expect(getAuthorName({ authorName: '', authorEmail: 'alice@test.com' })).toBe('alice@test.com')
  })

  it('returns Anonymous when both are null', () => {
    expect(getAuthorName({ authorName: null, authorEmail: null })).toBe('Anonymous')
  })

  it('returns Anonymous when both are undefined', () => {
    expect(getAuthorName({})).toBe('Anonymous')
  })
})

describe('buildPostUrl', () => {
  it('constructs correct URL', () => {
    expect(buildPostUrl('https://app.example.com', 'feature-requests', 'post_123')).toBe(
      'https://app.example.com/b/feature-requests/posts/post_123'
    )
  })

  it('handles trailing slash in rootUrl', () => {
    expect(buildPostUrl('https://app.example.com/', 'bugs', 'post_456')).toBe(
      'https://app.example.com//b/bugs/posts/post_456'
    )
  })
})

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('A&B')).toBe('A&amp;B')
  })

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    )
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(getErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('returns Unknown error for string', () => {
    expect(getErrorMessage('some string')).toBe('Unknown error')
  })

  it('returns Unknown error for null', () => {
    expect(getErrorMessage(null)).toBe('Unknown error')
  })

  it('returns Unknown error for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error')
  })

  it('returns Unknown error for number', () => {
    expect(getErrorMessage(42)).toBe('Unknown error')
  })
})
