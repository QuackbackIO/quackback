/**
 * Stand-ins shared by the real-DB conversation visibility matrices: realtime
 * fan-out, the webhook and notification bridges, and config. None of them
 * decides visibility. Each is a factory for a `vi.mock` call:
 *
 *   vi.mock('@/lib/server/realtime/conversation-channels', async () =>
 *     (await import('@/lib/server/__tests__/conversation-visibility-mocks')).channelMocks()
 *   )
 */
import { vi } from 'vitest'

const resolved = () => vi.fn().mockResolvedValue(undefined)

export function configMocks() {
  return {
    config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
    getBaseUrl: () => 'http://localhost:3000',
  }
}

export function channelMocks() {
  return {
    publishTicketEvent: vi.fn(),
    publishConversationEvent: vi.fn(),
    publishConversationOnlyEvent: vi.fn(),
    publishConversationMessage: vi.fn(),
    publishAgentConversationEvent: vi.fn(),
    publishConversationUpdate: vi.fn(),
    publishTyping: vi.fn(),
  }
}

export function ticketWebhookMocks() {
  return {
    emitTicketCreated: resolved(),
    emitTicketStatusChanged: resolved(),
    emitTicketAssigned: resolved(),
    emitTicketReplied: resolved(),
    emitTicketNoteAdded: resolved(),
    emitTicketExternalStatusChanged: resolved(),
  }
}

export function conversationWebhookMocks() {
  return {
    emitConversationCreated: resolved(),
    emitMessageCreated: resolved(),
    emitMessageNoteCreated: resolved(),
    emitMessageDeleted: resolved(),
    emitMessageUpdated: resolved(),
    emitConversationStatusChanged: resolved(),
    emitConversationAssigned: resolved(),
    emitConversationPriorityChanged: resolved(),
    emitConversationCsatSubmitted: resolved(),
    emitConversationCsatCommentAdded: resolved(),
  }
}

/*
 * The writers start work they do not await (a changelog auto-subscribe, a
 * channel lifecycle notice, the close-time attribute classifier, an attribute
 * change event, language detection). Left real, it can run after a test's
 * transaction rolls back and break the next test's queries, so each matrix
 * stands it in. None of it decides visibility.
 */

export function changelogSubscriptionMocks() {
  return { ensureAutoSubscribed: resolved() }
}

export function channelAdapterMocks() {
  return { requireChannelAdapter: () => ({ deliverLifecycleEvent: resolved() }) }
}

export function attributeClassifierMocks() {
  return { classifyConversationAttributes: resolved() }
}

export function eventDispatchMocks<T extends object>(actual: T) {
  return { ...actual, dispatchConversationAttributeChanged: resolved() }
}

export function notifyMocks() {
  return {
    notifyVisitorMessage: resolved(),
    notifyAgentReply: resolved(),
    notifyConversationStarted: resolved(),
  }
}
