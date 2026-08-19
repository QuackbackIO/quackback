import { describe, it, expect } from 'vitest'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import {
  API_KEY_SCOPES,
  parseApiKeyScopes,
  scopeForPermission,
  hasApiScope,
  permissionsWithinScopes,
} from '../api-key-scopes'

describe('parseApiKeyScopes', () => {
  it('returns null for a NULL column (legacy full-authority key)', () => {
    expect(parseApiKeyScopes(null)).toBeNull()
  })

  it('returns null for an empty stored array (treated as legacy full authority)', () => {
    expect(parseApiKeyScopes('[]')).toBeNull()
  })

  it('returns the stored scopes when they are all in the vocabulary', () => {
    expect(parseApiKeyScopes('["read:feedback","write:chat"]')).toEqual([
      'read:feedback',
      'write:chat',
    ])
  })

  it('drops entries outside the vocabulary but keeps the key scoped', () => {
    // An internal capability key (e.g. ["internal:tier-limits"]) is a scoped
    // key with NO general-API authority — it must not fall back to full access.
    expect(parseApiKeyScopes('["internal:tier-limits"]')).toEqual([])
    expect(parseApiKeyScopes('["internal:tier-limits","read:feedback"]')).toEqual(['read:feedback'])
  })

  it('fails closed on malformed JSON', () => {
    expect(parseApiKeyScopes('not json')).toEqual([])
    expect(parseApiKeyScopes('{"read:feedback":true}')).toEqual([])
  })
})

describe('scopeForPermission', () => {
  it('maps every catalogue permission to a vocabulary scope', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(API_KEY_SCOPES, permission).toContain(scopeForPermission(permission))
    }
  })

  it('maps feedback reads and writes to the feedback scopes', () => {
    expect(scopeForPermission(PERMISSIONS.POST_VIEW_PRIVATE)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.POST_EXPORT)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.POST_CREATE)).toBe('write:feedback')
    expect(scopeForPermission(PERMISSIONS.BOARD_MANAGE)).toBe('write:feedback')
  })

  it('maps changelog reads to read:feedback and writes to write:changelog (MCP convention)', () => {
    expect(scopeForPermission(PERMISSIONS.CHANGELOG_VIEW_DRAFT)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.CHANGELOG_MANAGE)).toBe('write:changelog')
  })

  it('maps help-center management to write:article', () => {
    expect(scopeForPermission(PERMISSIONS.HELP_CENTER_MANAGE)).toBe('write:article')
  })

  it('maps conversation and support permissions to the chat scopes', () => {
    expect(scopeForPermission(PERMISSIONS.CONVERSATION_VIEW)).toBe('read:chat')
    expect(scopeForPermission(PERMISSIONS.CONVERSATION_REPLY)).toBe('write:chat')
    expect(scopeForPermission(PERMISSIONS.TICKET_VIEW_ALL)).toBe('read:chat')
    expect(scopeForPermission(PERMISSIONS.TICKET_REPLY)).toBe('write:chat')
  })

  it('maps directory / workspace families onto the base feedback domain by verb', () => {
    expect(scopeForPermission(PERMISSIONS.PEOPLE_VIEW)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.PEOPLE_MANAGE)).toBe('write:feedback')
    expect(scopeForPermission(PERMISSIONS.MEMBER_VIEW)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.WEBHOOK_VIEW)).toBe('read:feedback')
    expect(scopeForPermission(PERMISSIONS.WEBHOOK_MANAGE)).toBe('write:feedback')
    expect(scopeForPermission(PERMISSIONS.SEGMENT_MANAGE)).toBe('write:feedback')
  })
})

describe('hasApiScope', () => {
  it('grants everything for a legacy (null-scope) key', () => {
    expect(hasApiScope(null, 'write:chat')).toBe(true)
  })

  it('requires the exact scope for a scoped key (write does not imply read)', () => {
    expect(hasApiScope(['read:feedback'], 'read:feedback')).toBe(true)
    expect(hasApiScope(['write:feedback'], 'read:feedback')).toBe(false)
    expect(hasApiScope([], 'read:feedback')).toBe(false)
  })
})

describe('permissionsWithinScopes', () => {
  it('filters a permission set to those whose mapped scope is held', () => {
    const base = new Set([
      PERMISSIONS.POST_VIEW_PRIVATE,
      PERMISSIONS.POST_CREATE,
      PERMISSIONS.CONVERSATION_VIEW,
    ])
    const filtered = permissionsWithinScopes(base, new Set(['read:feedback']))
    expect(filtered).toEqual(new Set([PERMISSIONS.POST_VIEW_PRIVATE]))
  })
})
