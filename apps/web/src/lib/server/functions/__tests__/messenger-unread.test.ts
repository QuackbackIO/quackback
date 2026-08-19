/**
 * Gating for getMessengerUnreadFn (Phase 7 unified unread). The aggregate SQL is
 * covered by conversation-unread-aggregate.test.ts; here we pin the wrapper's
 * guards: 0 when conversations are off or the caller is unauthenticated, the
 * real count for a team member (who skips the portal check), and 0 for a
 * non-team caller without portal access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: (() => Promise<unknown>) | null = null
    const fn = () => {
      if (!handler) throw new Error('handler not registered')
      return handler()
    }
    fn.validator = () => fn
    fn.handler = (h: () => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
  isConversationsEnabled: vi.fn(),
  resolvePortalAccess: vi.fn(),
  countVisitorUnread: vi.fn(),
  isTeamMember: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: hoisted.getOptionalAuth,
  hasAuthCredentials: hoisted.hasAuthCredentials,
  requireAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))
vi.mock('@/lib/shared/roles', () => ({ isTeamMember: hoisted.isTeamMember }))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.isConversationsEnabled,
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.resolvePortalAccess,
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  countVisitorUnreadMessages: hoisted.countVisitorUnread,
}))

import { getMessengerUnreadFn } from '../conversation'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.isConversationsEnabled.mockResolvedValue(true)
  hoisted.hasAuthCredentials.mockReturnValue(true)
  hoisted.getOptionalAuth.mockResolvedValue({ principal: { id: 'principal_v', role: 'user' } })
  hoisted.isTeamMember.mockReturnValue(false)
  hoisted.resolvePortalAccess.mockResolvedValue({ granted: true })
  hoisted.countVisitorUnread.mockResolvedValue(4)
})

describe('getMessengerUnreadFn', () => {
  it('returns 0 when conversations are disabled (never counts)', async () => {
    hoisted.isConversationsEnabled.mockResolvedValue(false)
    expect(await getMessengerUnreadFn()).toEqual({ conversations: 0, total: 0 })
    expect(hoisted.countVisitorUnread).not.toHaveBeenCalled()
  })

  it('returns 0 when the caller is unauthenticated', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(null)
    expect(await getMessengerUnreadFn()).toEqual({ conversations: 0, total: 0 })
    expect(hoisted.countVisitorUnread).not.toHaveBeenCalled()
  })

  it('counts for a team member without a portal check', async () => {
    hoisted.isTeamMember.mockReturnValue(true)
    expect(await getMessengerUnreadFn()).toEqual({ conversations: 4, total: 4 })
    expect(hoisted.resolvePortalAccess).not.toHaveBeenCalled()
    expect(hoisted.countVisitorUnread).toHaveBeenCalledWith('principal_v')
  })

  it('counts for a portal-authorized visitor', async () => {
    expect(await getMessengerUnreadFn()).toEqual({ conversations: 4, total: 4 })
  })

  it('returns 0 for a non-team caller without portal access', async () => {
    hoisted.resolvePortalAccess.mockResolvedValue({ granted: false })
    expect(await getMessengerUnreadFn()).toEqual({ conversations: 0, total: 0 })
    expect(hoisted.countVisitorUnread).not.toHaveBeenCalled()
  })
})
