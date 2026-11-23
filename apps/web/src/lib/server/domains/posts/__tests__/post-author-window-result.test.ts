/**
 * The author-window decision on facts already looked up: which wins when the
 * team acted, when others voted, and when the workspace keeps the window open.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import { authorWindowResult } from '../post.author-window'

const config = (features: Partial<PortalConfig['features']> = {}): PortalConfig => ({
  ...DEFAULT_PORTAL_CONFIG,
  features: { ...DEFAULT_PORTAL_CONFIG.features, ...features },
})

describe('authorWindowResult', () => {
  it('closes delete, not edit, when only other customers voted', () => {
    expect(authorWindowResult('edit', null, true, config())).toEqual({ allowed: true })
    expect(authorWindowResult('delete', null, true, config())).toEqual({
      allowed: false,
      reason: 'Cannot delete posts other people have voted on',
    })
  })

  it('names the team action first when both happened', () => {
    expect(authorWindowResult('delete', 'reply', true, config())).toEqual({
      allowed: false,
      reason: 'Cannot delete posts the team has replied to',
    })
  })

  it('keeps delete open after votes when the workspace allows delete after engagement', () => {
    expect(
      authorWindowResult('delete', null, true, config({ allowDeleteAfterEngagement: true }))
    ).toEqual({ allowed: true })
  })

  it('leaves both open on a post nobody else touched', () => {
    expect(authorWindowResult('edit', null, false, config())).toEqual({ allowed: true })
    expect(authorWindowResult('delete', null, false, config())).toEqual({ allowed: true })
  })
})
