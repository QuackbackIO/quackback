/**
 * Conversation participants (§4.8 group threads): an agent adds a second
 * customer to an existing conversation; the added customer then receives every
 * subsequent agent reply by email. These tests pin the three seams:
 *
 * 1. `addConversationParticipantByEmail` resolves the address to a principal —
 *    an existing user account wins, then a lead we minted from an earlier
 *    email, then a fresh lead — and records the (conversation, principal) row
 *    idempotently. Adding the conversation's own visitor is a no-op.
 * 2. `listParticipantReplyRecipients` turns the participant rows into
 *    deliverable addresses (account email, else contact email; synthetic
 *    anonymous placeholders never qualify), excluding the primary visitor and
 *    any address already being sent to.
 *
 * db access is mocked with the thenable-chain pattern from
 * conversation-notify.test.ts; the principal factory is mocked at its module
 * boundary (it owns every principal INSERT).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const hoisted = vi.hoisted(() => ({
  ensurePrincipalForUser: vi.fn(),
  createPrincipal: vi.fn(),
  // Programmable query results, consumed FIFO: each entry is the row array one
  // select...limit() resolves to. Inserts record their values here.
  selectQueue: [] as unknown[][],
  insertedRows: [] as unknown[],
  // FIFO results for insert...returning() and delete...returning(): a row array
  // (inserted/deleted) or [] (conflict / nothing matched).
  writeQueue: [] as unknown[][],
  deletedFrom: [] as unknown[],
  emitSystemMessage: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.innerJoin = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = async () => hoisted.selectQueue.shift() ?? []
    c.then = (resolve: (v: unknown) => unknown) => resolve(hoisted.selectQueue.shift() ?? [])
    return c
  }
  function insertChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.values = (v: unknown) => {
      hoisted.insertedRows.push(v)
      return c
    }
    c.onConflictDoNothing = () => c
    c.returning = async () => hoisted.writeQueue.shift() ?? []
    c.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return c
  }
  function deleteChain(table: unknown): Record<string, unknown> {
    hoisted.deletedFrom.push(table)
    const c: Record<string, unknown> = {}
    c.where = () => c
    c.returning = async () => hoisted.writeQueue.shift() ?? []
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain(), insert: () => insertChain(), delete: deleteChain },
  }
})

vi.mock('@/lib/server/logger', () => {
  const log = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const child = () => ({ ...log, child })
  return { logger: { ...log, child }, createLogger: () => ({ ...log, child }) }
})

vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: hoisted.ensurePrincipalForUser,
  createPrincipal: hoisted.createPrincipal,
}))

// The thread-notice seam (emitSystemMessage lives on the conversation write
// service); the participant service must record each change through it.
vi.mock('../conversation.service', () => ({
  emitSystemMessage: hoisted.emitSystemMessage,
}))

import {
  addConversationParticipantByEmail,
  removeConversationParticipant,
  listParticipantReplyRecipients,
} from '../conversation-participant.service'
import { conversationParticipants } from '@/lib/server/db'

const ACTOR = { principalId: 'principal_agent1' } as unknown as Actor
const CONVERSATION = 'conversation_c1'
const VISITOR = 'principal_visitor1'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.selectQueue.length = 0
  hoisted.insertedRows.length = 0
  hoisted.writeQueue.length = 0
  hoisted.deletedFrom.length = 0
  hoisted.emitSystemMessage.mockResolvedValue(undefined)
  // Default conversation lookup: exists, owned by VISITOR.
  hoisted.selectQueue.push([{ visitorPrincipalId: VISITOR }])
})

describe('addConversationParticipantByEmail', () => {
  it('attaches an existing user account by address and records the participant', async () => {
    hoisted.selectQueue.push([{ id: 'user_9' }]) // user lookup hits
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      principal: { id: 'principal_user9' },
      created: false,
    })

    const result = await addConversationParticipantByEmail(CONVERSATION, 'Pat@Example.com', ACTOR)

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith({
      userId: 'user_9',
      role: 'user',
    })
    expect(hoisted.createPrincipal).not.toHaveBeenCalled()
    expect(hoisted.insertedRows).toEqual([
      {
        conversationId: CONVERSATION,
        principalId: 'principal_user9',
        addedByPrincipalId: 'principal_agent1',
      },
    ])
    expect(result).toEqual({ principalId: 'principal_user9' })
  })

  it('reuses a lead minted from an earlier email instead of minting a second one', async () => {
    hoisted.selectQueue.push([]) // no user account
    hoisted.selectQueue.push([{ id: 'principal_lead1' }]) // lead lookup hits

    const result = await addConversationParticipantByEmail(CONVERSATION, 'lead@example.com', ACTOR)

    expect(hoisted.createPrincipal).not.toHaveBeenCalled()
    expect(hoisted.insertedRows[0]).toMatchObject({ principalId: 'principal_lead1' })
    expect(result).toEqual({ principalId: 'principal_lead1' })
  })

  it('mints a standalone lead for an address the workspace has never seen', async () => {
    hoisted.selectQueue.push([]) // no user account
    hoisted.selectQueue.push([]) // no existing lead
    hoisted.createPrincipal.mockResolvedValue({ id: 'principal_newlead' })

    const result = await addConversationParticipantByEmail(CONVERSATION, 'new@example.com', ACTOR)

    expect(hoisted.createPrincipal).toHaveBeenCalledWith({
      role: 'user',
      type: 'anonymous',
      contactEmail: 'new@example.com',
    })
    expect(hoisted.insertedRows[0]).toMatchObject({ principalId: 'principal_newlead' })
    expect(result).toEqual({ principalId: 'principal_newlead' })
  })

  it('lowercases the address before resolving (display case never forks identity)', async () => {
    hoisted.selectQueue.push([])
    hoisted.selectQueue.push([])
    hoisted.createPrincipal.mockResolvedValue({ id: 'principal_newlead' })

    await addConversationParticipantByEmail(CONVERSATION, 'Mixed.Case@Example.COM', ACTOR)

    expect(hoisted.createPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ contactEmail: 'mixed.case@example.com' })
    )
  })

  it("adding the conversation's own visitor is a no-op — no participant row", async () => {
    hoisted.selectQueue.push([{ id: 'user_v' }])
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      principal: { id: VISITOR },
      created: false,
    })

    const result = await addConversationParticipantByEmail(
      CONVERSATION,
      'visitor@example.com',
      ACTOR
    )

    expect(hoisted.insertedRows).toEqual([])
    expect(result).toEqual({ principalId: VISITOR as PrincipalId })
  })

  it('throws when the conversation does not exist', async () => {
    hoisted.selectQueue.length = 0
    hoisted.selectQueue.push([]) // conversation lookup misses
    await expect(
      addConversationParticipantByEmail(CONVERSATION, 'x@example.com', ACTOR)
    ).rejects.toThrow(/not found/i)
  })

  it('posts an internal thread notice when a new participant is added', async () => {
    hoisted.selectQueue.push([]) // no user account
    hoisted.selectQueue.push([{ id: 'principal_lead1' }])
    hoisted.writeQueue.push([{ principalId: 'principal_lead1' }]) // insert landed

    await addConversationParticipantByEmail(CONVERSATION, 'Lead@Example.com', ACTOR, {
      actorDisplayName: 'Agent Smith',
    })

    expect(hoisted.emitSystemMessage).toHaveBeenCalledTimes(1)
    const [conversationId, content, event, opts] = hoisted.emitSystemMessage.mock.calls[0]
    expect(conversationId).toBe(CONVERSATION)
    expect(content).toContain('lead@example.com')
    expect(content).toContain('Agent Smith')
    // Team-only: the customer has no business seeing membership churn.
    expect(event).toBeUndefined()
    expect(opts).toEqual({ internal: true })
  })

  it('posts no notice for an idempotent repeat add (no new row)', async () => {
    hoisted.selectQueue.push([]) // no user account
    hoisted.selectQueue.push([{ id: 'principal_lead1' }])
    hoisted.writeQueue.push([]) // onConflictDoNothing: nothing inserted

    await addConversationParticipantByEmail(CONVERSATION, 'lead@example.com', ACTOR)

    expect(hoisted.emitSystemMessage).not.toHaveBeenCalled()
  })
})

describe('removeConversationParticipant', () => {
  it('deletes the join row and posts an internal thread notice', async () => {
    hoisted.selectQueue.length = 0 // remove does not re-check the conversation
    // Participant lookup (for the notice label), then the delete returning a row.
    hoisted.selectQueue.push([
      {
        displayName: 'Pat Doe',
        userEmail: 'pat@example.com',
        contactEmail: null,
      },
    ])
    hoisted.writeQueue.push([{ principalId: 'principal_p1' }])

    const result = await removeConversationParticipant(
      CONVERSATION as never,
      'principal_p1' as never,
      ACTOR,
      { actorDisplayName: 'Agent Smith' }
    )

    expect(result).toEqual({ removed: true })
    expect(hoisted.deletedFrom).toEqual([conversationParticipants])
    expect(hoisted.emitSystemMessage).toHaveBeenCalledTimes(1)
    const [conversationId, content, , opts] = hoisted.emitSystemMessage.mock.calls[0]
    expect(conversationId).toBe(CONVERSATION)
    expect(content).toContain('pat@example.com')
    expect(content).toContain('Agent Smith')
    expect(opts).toEqual({ internal: true })
  })

  it('removing a never-added participant is a clean no-op — no error, no notice', async () => {
    hoisted.selectQueue.length = 0
    hoisted.selectQueue.push([]) // no such participant
    hoisted.writeQueue.push([]) // delete matched nothing

    const result = await removeConversationParticipant(
      CONVERSATION as never,
      'principal_ghost' as never,
      ACTOR
    )

    expect(result).toEqual({ removed: false })
    expect(hoisted.emitSystemMessage).not.toHaveBeenCalled()
  })

  it('a removed participant receives no further replies (fan-out reads the live join table)', async () => {
    // After the delete, the recipients read finds no rows — nothing to email.
    hoisted.selectQueue.length = 0
    hoisted.selectQueue.push([]) // label lookup: row already gone mid-flow is fine
    hoisted.writeQueue.push([{ principalId: 'principal_p1' }])
    await removeConversationParticipant(CONVERSATION as never, 'principal_p1' as never, ACTOR)

    hoisted.selectQueue.push([]) // join table now empty for this conversation
    const recipients = await listParticipantReplyRecipients(
      CONVERSATION as never,
      VISITOR as never,
      'visitor@example.com'
    )
    expect(recipients).toEqual([])
  })
})

describe('listParticipantReplyRecipients', () => {
  it('resolves deliverable addresses, skipping placeholders, the visitor, and the primary recipient', async () => {
    hoisted.selectQueue.length = 0
    hoisted.selectQueue.push([
      // Identified account user — account email wins.
      {
        principalId: 'principal_p1',
        type: 'user',
        userEmail: 'pat@example.com',
        contactEmail: null,
      },
      // Lead — contact email only.
      {
        principalId: 'principal_p2',
        type: 'anonymous',
        userEmail: null,
        contactEmail: 'lead@example.com',
      },
      // Synthetic anonymous address — never deliverable, dropped.
      {
        principalId: 'principal_p3',
        type: 'anonymous',
        userEmail: 'temp-123@anon.quackback.io',
        contactEmail: null,
      },
      // The conversation's own visitor, also a participant row — excluded.
      {
        principalId: VISITOR,
        type: 'user',
        userEmail: 'visitor@example.com',
        contactEmail: null,
      },
      // Same address as the primary recipient — excluded (no double send).
      {
        principalId: 'principal_p4',
        type: 'user',
        userEmail: 'primary@example.com',
        contactEmail: null,
      },
    ])

    const recipients = await listParticipantReplyRecipients(
      CONVERSATION as never,
      VISITOR as never,
      'primary@example.com'
    )

    expect(recipients).toEqual([
      { principalId: 'principal_p1', email: 'pat@example.com' },
      { principalId: 'principal_p2', email: 'lead@example.com' },
    ])
  })
})
