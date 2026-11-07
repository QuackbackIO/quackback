import { describe, expect, it } from 'vitest'
import { shellPageOf } from '../portal-shell'

describe('the page the portal shell names', () => {
  it('names each page, its items under it, and Home or the feed at the root', () => {
    expect(shellPageOf('/', true)).toBe('home')
    expect(shellPageOf('/', false)).toBe('feedback')
    expect(shellPageOf('/roadmap', true)).toBe('roadmap')
    expect(shellPageOf('/changelog/entry-1', true)).toBe('changelog')
    expect(shellPageOf('/hc/articles/getting-started', true)).toBe('help')
    expect(shellPageOf('/b/web/posts/post_1', true)).toBe('post')
    expect(shellPageOf('/status', true)).toBe('status')
  })

  it('names a turned-off page’s sample by its page, and nothing for pages backgrounds do not name', () => {
    expect(shellPageOf('/design-sample/support', true)).toBe('support')
    expect(shellPageOf('/settings/profile', true)).toBeNull()
    expect(shellPageOf('/design-sample/nope', true)).toBeNull()
  })
})
