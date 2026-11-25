import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: () => vi.fn(),
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isConversationsEnabledFor: vi.fn(),
  resolvePortalAccessForRequest: vi.fn(),
  isBlocked: vi.fn(),
  assertConversationSendRate: vi.fn(),
  policyActorFromAuth: vi.fn(),
  sendVisitorMessage: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: hoisted.getSettings,
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabledFor: hoisted.isConversationsEnabledFor,
  isSupportTicketsEnabled: vi.fn(async () => false),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.resolvePortalAccessForRequest,
}))
vi.mock('@/lib/server/domains/principals/blocking', () => ({
  isBlocked: hoisted.isBlocked,
}))
vi.mock('@/lib/server/domains/conversation/conversation.ratelimit', () => ({
  assertConversationSendRate: hoisted.assertConversationSendRate,
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn(),
  requireAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: hoisted.policyActorFromAuth,
  hasAuthCredentials: vi.fn(() => false),
  normalizePrincipalType: (raw: string | null | undefined) =>
    raw === 'anonymous' || raw === 'support' || raw === 'service' ? raw : 'user',
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  CSAT_CONVERSATION_OPEN: 'CSAT_CONVERSATION_OPEN',
  sendVisitorMessage: hoisted.sendVisitorMessage,
}))

import { runSendConversationMessage } from '../conversation'
import type { AuthContext } from '../auth-helpers'

function makeCtx(principalType: string, role: 'user' | 'admin' = 'user'): AuthContext {
  return {
    settings: {
      id: 'ws_1',
      slug: 'test',
      name: 'Test',
      logoKey: null,
    } as unknown as AuthContext['settings'],
    user: {
      id: 'user_1',
      email: 'u@example.com',
      name: 'User',
      image: null,
    } as AuthContext['user'],
    principal: { id: 'principal_1', role, type: principalType } as AuthContext['principal'],
    permissions: [],
    scope: 'widget',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.isConversationsEnabledFor.mockResolvedValue(true)
  hoisted.resolvePortalAccessForRequest.mockResolvedValue({ granted: true })
  hoisted.isBlocked.mockResolvedValue(false)
  hoisted.assertConversationSendRate.mockResolvedValue(undefined)
  hoisted.policyActorFromAuth.mockResolvedValue({
    principalId: 'p_1',
    role: 'user',
    principalType: 'anonymous',
    segmentIds: [],
  })
  hoisted.sendVisitorMessage.mockResolvedValue({ ok: true, id: 'msg_1' })
})

describe('assertVisitorConversationAccess Zero-Anonymous guard', () => {
  it('blocks anonymous principal when workspace allowAnonymous is false or unset', async () => {
    hoisted.getSettings.mockResolvedValue({
      id: 'ws_1',
      portalConfig: JSON.stringify({ features: { allowAnonymous: false } }),
    })
    await expect(
      runSendConversationMessage(makeCtx('anonymous'), { content: 'hello' } as never)
    ).rejects.toThrow('Sign in to start a conversation')
    expect(hoisted.sendVisitorMessage).not.toHaveBeenCalled()

    hoisted.getSettings.mockResolvedValue({ id: 'ws_1' })
    await expect(
      runSendConversationMessage(makeCtx('anonymous'), { content: 'hello' } as never)
    ).rejects.toThrow('Sign in to start a conversation')
    expect(hoisted.sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('allows anonymous principal when workspace allowAnonymous is explicitly true', async () => {
    hoisted.getSettings.mockResolvedValue({
      id: 'ws_1',
      portalConfig: JSON.stringify({ features: { allowAnonymous: true } }),
    })
    await expect(
      runSendConversationMessage(makeCtx('anonymous'), { content: 'hello' } as never)
    ).resolves.toMatchObject({ ok: true })
    expect(hoisted.sendVisitorMessage).toHaveBeenCalledTimes(1)
  })

  it('allows identified user principal even when allowAnonymous is false', async () => {
    hoisted.getSettings.mockResolvedValue({
      id: 'ws_1',
      portalConfig: JSON.stringify({ features: { allowAnonymous: false } }),
    })
    await expect(
      runSendConversationMessage(makeCtx('user'), { content: 'hello' } as never)
    ).resolves.toMatchObject({ ok: true })
    expect(hoisted.sendVisitorMessage).toHaveBeenCalledTimes(1)
  })
})
