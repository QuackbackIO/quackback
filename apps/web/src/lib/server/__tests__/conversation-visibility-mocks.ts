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

export function notifyMocks() {
  return {
    notifyVisitorMessage: resolved(),
    notifyAgentReply: resolved(),
    notifyConversationStarted: resolved(),
  }
}

/**
 * The recipient scope rule with every teammate in scope, for unit suites that
 * mock the database. Rows the caller passes still go through the teammate
 * check (type `user`, role admin or member); bare ids are taken as teammates.
 * A named `requesterPrincipalId` in the input is kept, for any item. The stub
 * does not know the item, so it does NOT model the real rule's requester
 * condition (a customer ticket that is not deleted): a unit suite using it
 * cannot catch a regression there. That condition is covered over real rows
 * in recipient-scope.db.test.ts and notification-scope.db.test.ts.
 * The rule itself runs over real rows in
 * events/__tests__/notification-scope.db.test.ts and
 * domains/notifications/__tests__/recipient-scope.db.test.ts.
 */
export function recipientScopePassThrough() {
  type Candidate = string | { id: string; type: string; role: string }
  const teammates = (candidates: readonly Candidate[]) => [
    ...new Set(
      candidates.flatMap((c) =>
        typeof c === 'string'
          ? [c]
          : c.type === 'user' && (c.role === 'admin' || c.role === 'member')
            ? [c.id]
            : []
      )
    ),
  ]
  return {
    inScopeRecipients: vi.fn(
      async (
        _item: unknown,
        candidates: readonly Candidate[],
        opts: { requesterPrincipalId?: string | null } = {}
      ) => {
        const kept = new Set(teammates(candidates))
        const requester = opts.requesterPrincipalId ?? null
        return candidates
          .map((c) => (typeof c === 'string' ? c : c.id))
          .filter((id, i, all) => all.indexOf(id) === i)
          .filter((id) => kept.has(id) || id === requester)
      }
    ),
    teammateView: vi.fn(async (_item: unknown, candidates: readonly Candidate[]) => ({
      visible: new Set(teammates(candidates)),
      hidden: new Set<string>(),
    })),
  }
}
