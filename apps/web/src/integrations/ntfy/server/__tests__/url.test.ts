import { describe, it, expect } from 'vitest'
import { parseNtfyUrl } from '@/integrations/ntfy/server/url'

describe('parseNtfyUrl', () => {
  it('parses a valid ntfy.sh topic URL into origin + topic', () => {
    expect(parseNtfyUrl('https://ntfy.sh/my-topic')).toEqual({
      origin: 'https://ntfy.sh',
      topic: 'my-topic',
    })
  })

  it('parses a self-hosted URL (host + port preserved as origin)', () => {
    expect(parseNtfyUrl('https://ntfy.example.com:8443/alerts_1')).toEqual({
      origin: 'https://ntfy.example.com:8443',
      topic: 'alerts_1',
    })
  })

  it('normalizes a trailing slash', () => {
    expect(parseNtfyUrl('https://ntfy.sh/my-topic/')).toEqual({
      origin: 'https://ntfy.sh',
      topic: 'my-topic',
    })
  })

  it('rejects a multi-segment path (invalid topic)', () => {
    expect(parseNtfyUrl('https://ntfy.sh/a/b')).toBeNull()
  })

  it('rejects a URL with no topic (root)', () => {
    expect(parseNtfyUrl('https://ntfy.sh/')).toBeNull()
    expect(parseNtfyUrl('https://ntfy.sh')).toBeNull()
  })

  it('rejects topics with illegal characters', () => {
    expect(parseNtfyUrl('https://ntfy.sh/has spaces')).toBeNull()
    expect(parseNtfyUrl('https://ntfy.sh/emoji😀')).toBeNull()
  })

  it('rejects topics longer than 64 chars', () => {
    expect(parseNtfyUrl(`https://ntfy.sh/${'a'.repeat(65)}`)).toBeNull()
  })

  it('returns null for a malformed URL', () => {
    expect(parseNtfyUrl('not-a-url')).toBeNull()
  })
})
