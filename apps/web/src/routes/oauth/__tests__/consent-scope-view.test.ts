/**
 * The consent screen must surface every scope the user is granting.
 * offline_access issues a refresh token (long-lived access), so it gets its
 * own human-readable row; only the identity scopes that are implicit in
 * signing in (openid/profile/email) stay hidden.
 */
import { describe, expect, it } from 'vitest'

const { buildScopeView } = await import('../consent')

describe('buildScopeView', () => {
  it('hides the implicit identity scopes', () => {
    const view = buildScopeView(['openid', 'profile', 'email'])
    expect(view.groups).toEqual([])
    expect(view.offlineAccess).toBe(false)
  })

  it('surfaces offline_access instead of hiding it', () => {
    const view = buildScopeView(['openid', 'offline_access'])
    expect(view.offlineAccess).toBe(true)
    expect(view.groups).toEqual([])
  })

  it('groups read/write scope pairs by area', () => {
    const view = buildScopeView(['read:feedback', 'write:feedback', 'read:article'])
    expect(view.groups).toEqual([
      expect.objectContaining({ label: 'Feedback', read: true, write: true }),
      expect.objectContaining({ label: 'Help Center', read: true, write: false }),
    ])
    expect(view.offlineAccess).toBe(false)
  })

  it('renders the full MCP scope set as groups plus offline access', () => {
    const view = buildScopeView([
      'openid',
      'profile',
      'email',
      'offline_access',
      'read:feedback',
      'write:feedback',
      'write:changelog',
      'read:article',
      'write:article',
      'read:chat',
      'write:chat',
    ])
    expect(view.groups.map((g) => g.label)).toEqual([
      'Feedback',
      'Changelog',
      'Help Center',
      'Conversations',
    ])
    expect(view.offlineAccess).toBe(true)
  })
})
