import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Ticket } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

const dispatch = vi.hoisted(() => ({
  dispatchTicketCreated: vi.fn().mockResolvedValue(undefined),
  dispatchTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  dispatchTicketAssigned: vi.fn().mockResolvedValue(undefined),
  dispatchTicketReplied: vi.fn().mockResolvedValue(undefined),
  dispatchTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/dispatch', () => dispatch)

import {
  emitTicketCreated,
  emitTicketStatusChanged,
  emitTicketAssigned,
  emitTicketReplied,
  emitTicketNoteAdded,
} from '../ticket.webhooks'

const now = new Date('2026-07-04T00:00:00.000Z')
const baseTicket = {
  id: 'ticket_1',
  number: 42,
  type: 'customer',
  title: 'Cannot log in',
  statusId: 'ticket_status_1',
  priority: 'high',
  requesterPrincipalId: 'principal_r',
  assigneePrincipalId: null,
  assigneeTeamId: null,
  companyId: 'company_1',
  firstResponseAt: null,
  dueAt: null,
  resolvedAt: null,
  reopenedCount: 0,
  customAttributes: {},
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
} as unknown as Ticket

const agentActor: Actor = {
  principalId: 'principal_a',
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
} as unknown as Actor

/** A ticket-thread message DTO as returned by insertTicketMessage. */
const baseMessage = {
  id: 'conversation_message_1',
  conversationId: null,
  ticketId: 'ticket_1',
  senderType: 'agent',
  content: 'Thanks for the report, we are on it.',
  createdAt: now.toISOString(),
  author: null,
  attachments: [],
  citations: [],
  isAssistant: false,
  isInternal: false,
  contentJson: null,
  viaEmail: false,
  systemEvent: null,
} as unknown as ConversationMessageDTO

beforeEach(() => Object.values(dispatch).forEach((m) => m.mockClear()))

describe('ticket.webhooks emit helpers', () => {
  it('emitTicketCreated sends EventTicketData with a user actor + status category + stage', async () => {
    await emitTicketCreated(agentActor, baseTicket, { category: 'open', stage: 'received' })
    expect(dispatch.dispatchTicketCreated).toHaveBeenCalledTimes(1)
    const [actorArg, dataArg] = dispatch.dispatchTicketCreated.mock.calls[0]
    expect(actorArg).toMatchObject({ type: 'user', principalId: 'principal_a' })
    expect(dataArg).toMatchObject({
      id: 'ticket_1',
      number: 42,
      type: 'customer',
      title: 'Cannot log in',
      status: 'open',
      stage: 'received',
      priority: 'high',
      requesterPrincipalId: 'principal_r',
      companyId: 'company_1',
      createdAt: '2026-07-04T00:00:00.000Z',
      resolvedAt: null,
    })
  })

  it('emitTicketCreated with a service actor carries a service actor type', async () => {
    const serviceActor = { ...agentActor, principalType: 'service' } as unknown as Actor
    await emitTicketCreated(serviceActor, baseTicket, { category: 'open', stage: null })
    const [actorArg, dataArg] = dispatch.dispatchTicketCreated.mock.calls[0]
    expect(actorArg).toMatchObject({ type: 'service', principalId: 'principal_a' })
    expect(dataArg.stage).toBeNull()
  })

  it('emitTicketStatusChanged passes previous then new category + the new stage', async () => {
    await emitTicketStatusChanged(agentActor, baseTicket, 'open', 'closed', 'resolved')
    expect(dispatch.dispatchTicketStatusChanged).toHaveBeenCalledTimes(1)
    const [, ref, previousStatus, newStatus, stage] =
      dispatch.dispatchTicketStatusChanged.mock.calls[0]
    expect(ref).toEqual({
      id: 'ticket_1',
      number: 42,
      type: 'customer',
      priority: 'high',
      assignedPrincipalId: null,
      assignedTeamId: null,
    })
    expect(previousStatus).toBe('open')
    expect(newStatus).toBe('closed')
    expect(stage).toBe('resolved')
  })

  it('emitTicketAssigned reports the ticket assignee as new and passes the previous', async () => {
    const assigned = {
      ...baseTicket,
      assigneePrincipalId: 'principal_a',
      assigneeTeamId: 'team_1',
    } as unknown as Ticket
    await emitTicketAssigned(agentActor, assigned, null, null)
    const [, ref, assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId] =
      dispatch.dispatchTicketAssigned.mock.calls[0]
    expect(ref).toMatchObject({ assignedPrincipalId: 'principal_a', assignedTeamId: 'team_1' })
    expect(assignedPrincipalId).toBe('principal_a')
    expect(previousPrincipalId).toBeNull()
    expect(assignedTeamId).toBe('team_1')
    expect(previousTeamId).toBeNull()
  })
})

describe('ticket.webhooks reply + note emit helpers', () => {
  it('emitTicketReplied fires ticket.replied with the ref, message id, markdown content, and senderType', async () => {
    await emitTicketReplied(agentActor, baseTicket, baseMessage)
    expect(dispatch.dispatchTicketReplied).toHaveBeenCalledTimes(1)
    const [actorArg, ref, messageId, content, attachments, senderType] =
      dispatch.dispatchTicketReplied.mock.calls[0]
    expect(actorArg).toMatchObject({ type: 'user', principalId: 'principal_a' })
    expect(ref).toEqual({
      id: 'ticket_1',
      number: 42,
      type: 'customer',
      priority: 'high',
      assignedPrincipalId: null,
      assignedTeamId: null,
    })
    expect(messageId).toBe('conversation_message_1')
    expect(content).toBe('Thanks for the report, we are on it.')
    expect(attachments).toBeNull()
    expect(senderType).toBe('agent')
  })

  it('emitTicketReplied carries senderType visitor for a requester reply', async () => {
    const requesterReply = { ...baseMessage, senderType: 'visitor' } as unknown as ConversationMessageDTO
    await emitTicketReplied(agentActor, baseTicket, requesterReply)
    const [, , , , , senderType] = dispatch.dispatchTicketReplied.mock.calls[0]
    expect(senderType).toBe('visitor')
  })

  it('emitTicketReplied maps attachments to {name,url,contentType,size}', async () => {
    const withAttachment = {
      ...baseMessage,
      attachments: [
        { url: 'https://cdn.example.com/log.txt', name: 'log.txt', contentType: 'text/plain', size: 1234 },
      ],
    } as unknown as ConversationMessageDTO
    await emitTicketReplied(agentActor, baseTicket, withAttachment)
    const [, , , , attachments] = dispatch.dispatchTicketReplied.mock.calls[0]
    expect(attachments).toEqual([
      { name: 'log.txt', url: 'https://cdn.example.com/log.txt', contentType: 'text/plain', size: 1234 },
    ])
  })

  it('emitTicketReplied derives image markdown from a rich contentJson', async () => {
    const richReply = {
      ...baseMessage,
      content: 'See attached screenshot.',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'See attached screenshot.' }] },
          {
            type: 'image',
            attrs: { src: 'https://cdn.example.com/shot.png', alt: 'Screenshot', title: null },
          },
        ],
      },
    } as unknown as ConversationMessageDTO
    await emitTicketReplied(agentActor, baseTicket, richReply)
    const [, , , content] = dispatch.dispatchTicketReplied.mock.calls[0]
    expect(content).toContain('![Screenshot](https://cdn.example.com/shot.png)')
  })

  it('emitTicketNoteAdded fires ticket.note_added with the full note content and senderType agent', async () => {
    const note = {
      ...baseMessage,
      isInternal: true,
      content: 'Customer is a VIP; escalate to tier 2.',
    } as unknown as ConversationMessageDTO
    await emitTicketNoteAdded(agentActor, baseTicket, note)
    expect(dispatch.dispatchTicketNoteAdded).toHaveBeenCalledTimes(1)
    const [actorArg, ref, messageId, content, attachments, senderType] =
      dispatch.dispatchTicketNoteAdded.mock.calls[0]
    expect(actorArg).toMatchObject({ type: 'user', principalId: 'principal_a' })
    expect(ref).toMatchObject({ id: 'ticket_1', number: 42 })
    expect(messageId).toBe('conversation_message_1')
    expect(content).toBe('Customer is a VIP; escalate to tier 2.')
    expect(attachments).toBeNull()
    expect(senderType).toBe('agent')
  })

  it('a dispatch failure never propagates from the reply/note helpers (fire-and-forget)', async () => {
    dispatch.dispatchTicketReplied.mockRejectedValueOnce(new Error('bus down'))
    dispatch.dispatchTicketNoteAdded.mockRejectedValueOnce(new Error('bus down'))
    await expect(emitTicketReplied(agentActor, baseTicket, baseMessage)).resolves.toBeUndefined()
    await expect(emitTicketNoteAdded(agentActor, baseTicket, baseMessage)).resolves.toBeUndefined()
  })

  it('emitTicketCreated does not also fire a reply or note event (creation is not a reply)', async () => {
    await emitTicketCreated(agentActor, baseTicket, { category: 'open', stage: 'received' })
    expect(dispatch.dispatchTicketReplied).not.toHaveBeenCalled()
    expect(dispatch.dispatchTicketNoteAdded).not.toHaveBeenCalled()
  })
})
