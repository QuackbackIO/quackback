import { describe, it, expect, vi, beforeEach } from 'vitest'

type HandlerArgs = { data?: Record<string, unknown> }
type AnyHandler = (args?: HandlerArgs) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPolicyActorFromAuth: vi.fn(),
  // settings.support (dynamically imported inside the helpers)
  mockIsConversationsEnabled: vi.fn(),
  mockIsSupportSurfaceEnabled: vi.fn(),
  mockEvaluateSupportAccessForRequest: vi.fn(),
  // portal-access (dynamically imported)
  mockResolvePortalAccessForRequest: vi.fn(),
  // chat.service (dynamically imported by markChatReadFn / sendChatTypingFn)
  mockSignalTyping: vi.fn(),
  mockIsTeamMember: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  getOptionalAuth: vi.fn(),
  requireAuth: hoisted.mockRequireAuth,
  policyActorFromAuth: hoisted.mockPolicyActorFromAuth,
  hasAuthCredentials: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.mockIsConversationsEnabled,
  isSupportSurfaceEnabled: hoisted.mockIsSupportSurfaceEnabled,
  evaluateSupportAccessForRequest: hoisted.mockEvaluateSupportAccessForRequest,
}))

vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.mockResolvePortalAccessForRequest,
}))

vi.mock('@/lib/server/domains/chat/chat.service', () => ({
  signalTyping: hoisted.mockSignalTyping,
}))

vi.mock('@/lib/shared/roles', () => ({
  isTeamMember: (...args: unknown[]) => hoisted.mockIsTeamMember(...args),
}))

// Handler registration order in chat.ts (visitor section first):
//  0 getSupportSurfaceAccessFn
//  1 sendChatMessageFn
//  2 getChatPresenceFn
//  3 getMyChatFn
//  4 getMyConversationsFn
//  5 listChatMessagesFn
//  6 markChatReadFn
//  7 sendChatTypingFn
const GET_SUPPORT_SURFACE_ACCESS = 0
const SEND_CHAT_TYPING = 7

let getSupportSurfaceAccessHandler: AnyHandler
let sendChatTypingHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../chat')
  }
  getSupportSurfaceAccessHandler = handlersByIndex[GET_SUPPORT_SURFACE_ACCESS]
  sendChatTypingHandler = handlersByIndex[SEND_CHAT_TYPING]
})

// ---------------------------------------------------------------------------
// canUseVisitorChatSurface (via getSupportSurfaceAccessFn)
// ---------------------------------------------------------------------------

describe('canUseVisitorChatSurface (via getSupportSurfaceAccessFn)', () => {
  it('returns granted=false when support access is denied', async () => {
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: false })

    const result = (await getSupportSurfaceAccessHandler({ data: { surface: 'widget' } })) as {
      granted: boolean
    }

    expect(result.granted).toBe(false)
    expect(hoisted.mockResolvePortalAccessForRequest).not.toHaveBeenCalled()
  })

  it('returns granted=true for a widget surface with support access', async () => {
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: true })

    const result = (await getSupportSurfaceAccessHandler({ data: { surface: 'widget' } })) as {
      granted: boolean
    }

    expect(result.granted).toBe(true)
    // Widget surface does not consult portal access.
    expect(hoisted.mockResolvePortalAccessForRequest).not.toHaveBeenCalled()
  })

  it('defers to portal access for the portal surface — granted', async () => {
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: true })
    hoisted.mockResolvePortalAccessForRequest.mockResolvedValue({ granted: true })

    const result = (await getSupportSurfaceAccessHandler({ data: { surface: 'portal' } })) as {
      granted: boolean
    }

    expect(result.granted).toBe(true)
    expect(hoisted.mockResolvePortalAccessForRequest).toHaveBeenCalledTimes(1)
  })

  it('defers to portal access for the portal surface — denied', async () => {
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: true })
    hoisted.mockResolvePortalAccessForRequest.mockResolvedValue({ granted: false })

    const result = (await getSupportSurfaceAccessHandler({ data: { surface: 'portal' } })) as {
      granted: boolean
    }

    expect(result.granted).toBe(false)
  })

  it('swallows errors and returns granted=false', async () => {
    hoisted.mockEvaluateSupportAccessForRequest.mockRejectedValue(new Error('boom'))

    const result = (await getSupportSurfaceAccessHandler({ data: { surface: 'widget' } })) as {
      granted: boolean
    }

    expect(result.granted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// assertVisitorChatAccess (via sendChatTypingFn)
// ---------------------------------------------------------------------------

describe('assertVisitorChatAccess (via sendChatTypingFn)', () => {
  it('lets a team member through after asserting conversations are enabled', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'member' } })
    hoisted.mockIsTeamMember.mockReturnValue(true)
    hoisted.mockIsConversationsEnabled.mockResolvedValue(true)
    hoisted.mockPolicyActorFromAuth.mockResolvedValue({ principalType: 'user' })
    hoisted.mockSignalTyping.mockResolvedValue(undefined)

    const result = (await sendChatTypingHandler({
      data: { conversationId: 'conv_1', surface: 'widget' },
    })) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(hoisted.mockIsConversationsEnabled).toHaveBeenCalledTimes(1)
    // Team path bypasses the support-surface + portal checks.
    expect(hoisted.mockIsSupportSurfaceEnabled).not.toHaveBeenCalled()
  })

  it('throws for a team member when conversations are disabled', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
    hoisted.mockIsTeamMember.mockReturnValue(true)
    hoisted.mockIsConversationsEnabled.mockResolvedValue(false)

    await expect(
      sendChatTypingHandler({ data: { conversationId: 'conv_1', surface: 'widget' } })
    ).rejects.toThrow('Chat is not enabled')
  })

  it('throws when a visitor provides no surface', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'user' } })
    hoisted.mockIsTeamMember.mockReturnValue(false)

    await expect(sendChatTypingHandler({ data: { conversationId: 'conv_1' } })).rejects.toThrow(
      'Support surface is required'
    )
  })

  it('throws when the visitor surface is not enabled', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'user' } })
    hoisted.mockIsTeamMember.mockReturnValue(false)
    hoisted.mockIsSupportSurfaceEnabled.mockResolvedValue(false)

    await expect(
      sendChatTypingHandler({ data: { conversationId: 'conv_1', surface: 'widget' } })
    ).rejects.toThrow('Chat is not enabled')
  })

  it('throws when support access is not granted', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'user' } })
    hoisted.mockIsTeamMember.mockReturnValue(false)
    hoisted.mockIsSupportSurfaceEnabled.mockResolvedValue(true)
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: false })

    await expect(
      sendChatTypingHandler({ data: { conversationId: 'conv_1', surface: 'widget' } })
    ).rejects.toThrow('Support access required')
  })

  it('throws when a portal visitor lacks portal access', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'user' } })
    hoisted.mockIsTeamMember.mockReturnValue(false)
    hoisted.mockIsSupportSurfaceEnabled.mockResolvedValue(true)
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: true })
    hoisted.mockResolvePortalAccessForRequest.mockResolvedValue({ granted: false })

    await expect(
      sendChatTypingHandler({ data: { conversationId: 'conv_1', surface: 'portal' } })
    ).rejects.toThrow('Portal access required')
  })

  it('passes a portal visitor with full access through to the action', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'user' } })
    hoisted.mockIsTeamMember.mockReturnValue(false)
    hoisted.mockIsSupportSurfaceEnabled.mockResolvedValue(true)
    hoisted.mockEvaluateSupportAccessForRequest.mockResolvedValue({ granted: true })
    hoisted.mockResolvePortalAccessForRequest.mockResolvedValue({ granted: true })
    hoisted.mockPolicyActorFromAuth.mockResolvedValue({ principalType: 'user' })
    hoisted.mockSignalTyping.mockResolvedValue(undefined)

    const result = (await sendChatTypingHandler({
      data: { conversationId: 'conv_1', surface: 'portal' },
    })) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(hoisted.mockSignalTyping).toHaveBeenCalledTimes(1)
  })
})
