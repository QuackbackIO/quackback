/**
 * Target resolution for the new-message team bell (WO-3 slice 5, the
 * riskiest move — replaces the deleted team-bell block in
 * notifyVisitorMessage). getMessageCreatedTargets deliberately reproduces
 * notifyVisitorMessage's ORIGINAL recipient query (role-only, no
 * `principal.type` filter) rather than reusing `listAssignableTeammates`
 * (which additionally requires `type: 'user'`) — preserving behavior exactly
 * is the point of this slice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

let teamRows: Array<{ principalId: string }> = []
// Convergence Phase 1a: the resolver first probes for a customer-ticket link
// on the message's conversation and suppresses the team-wide bell on a hit.
let pairRows: Array<{ ticketId: string }> = []

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    // Discriminate by the selected columns: the pair probe selects
    // { ticketId } from ticket_conversations (and is awaited via .limit(1));
    // the team query selects { principalId } from principal (awaited
    // directly). Both get a thenable with a `limit` tail.
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const rows = cols && 'ticketId' in cols ? pairRows : teamRows
          return Object.assign(Promise.resolve(rows), {
            limit: async (n: number) => rows.slice(0, n),
          })
        },
      }),
    }),
  },
}))

const { getMessageCreatedTargets } = await import('../targets')

beforeEach(() => {
  teamRows = []
  pairRows = []
})

const conversationRef = {
  id: 'conversation_1',
  status: 'open' as const,
  channel: 'messenger' as const,
  priority: 'none' as const,
}

function makeEvent(
  messageOverrides: Partial<Record<string, unknown>> = {},
  isFirstMessage = true
): EventData {
  return {
    id: 'evt-1',
    type: 'message.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_visitor' },
    data: {
      message: {
        id: 'conversation_msg_1',
        conversationId: 'conversation_1',
        senderType: 'visitor',
        authorPrincipalId: 'principal_visitor',
        authorName: 'Jane',
        authorEmail: null,
        content: 'hello team, need help',
        createdAt: '2026-01-01T00:00:00Z',
        ...messageOverrides,
      },
      conversation: conversationRef,
      isFirstMessage,
    },
  } as EventData
}

describe('getMessageCreatedTargets', () => {
  it('targets every admin/member principal for a visitor message', async () => {
    teamRows = [{ principalId: 'principal_admin' }, { principalId: 'principal_member' }]

    const target = await getMessageCreatedTargets(makeEvent())
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_admin', 'principal_member'] },
      config: {
        conversationId: 'conversation_1',
        authorName: 'Jane',
        preview: 'hello team, need help',
        isFirstMessage: true,
      },
    })
  })

  it('falls back to "A visitor" when the author has no display name', async () => {
    teamRows = [{ principalId: 'principal_admin' }]

    const target = await getMessageCreatedTargets(makeEvent({ authorName: null }))
    expect(target?.config).toMatchObject({ authorName: 'A visitor' })
  })

  it('truncates a long message to 140 chars for the preview', async () => {
    teamRows = [{ principalId: 'principal_admin' }]
    const long = 'x'.repeat(300)

    const target = await getMessageCreatedTargets(makeEvent({ content: long }))
    expect((target?.config.preview as string).length).toBeLessThanOrEqual(140)
  })

  it('is a no-op for an agent-sent message (never bells the team on its own reply)', async () => {
    teamRows = [{ principalId: 'principal_admin' }]

    expect(await getMessageCreatedTargets(makeEvent({ senderType: 'agent' }))).toBeNull()
  })

  it('is a no-op when there are no team members', async () => {
    teamRows = []
    expect(await getMessageCreatedTargets(makeEvent())).toBeNull()
  })

  it('carries isFirstMessage=false through to config unchanged', async () => {
    teamRows = [{ principalId: 'principal_admin' }]
    const target = await getMessageCreatedTargets(makeEvent({}, false))
    expect(target?.config).toMatchObject({ isFirstMessage: false })
  })

  // CONVERGENCE PHASE 1a (changelog-flagged behavior change): the team-wide
  // bell is suppressed for pair conversations — the watcher-scoped
  // `ticket.replied` fan-out replaces it.
  it('suppresses the team-wide bell for a conversation paired with a customer ticket', async () => {
    teamRows = [{ principalId: 'principal_admin' }, { principalId: 'principal_member' }]
    pairRows = [{ ticketId: 'ticket_1' }]

    expect(await getMessageCreatedTargets(makeEvent())).toBeNull()
  })

  it('still bells the team for a pair-less conversation', async () => {
    teamRows = [{ principalId: 'principal_admin' }]
    pairRows = []

    const target = await getMessageCreatedTargets(makeEvent())
    expect(target?.type).toBe('notification')
  })
})
