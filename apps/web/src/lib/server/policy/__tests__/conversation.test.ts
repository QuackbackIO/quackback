/**
 * Authorization matrix for conversations. Pure-function policy: who may read a
 * conversation, post as the visitor, start a conversation, or act as an agent.
 */
import { describe, it, expect } from 'vitest'
import {
  canViewConversation,
  canSendVisitorMessage,
  canStartConversation,
  canActAsAgent,
  canDeleteMessage,
  canEditMessage,
  type ConversationShape,
} from '../conversation'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const VISITOR = 'principal_visitor' as PrincipalId
const OTHER = 'principal_other' as PrincipalId

const visitorActor: Actor = {
  principalId: VISITOR,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const anonVisitorActor: Actor = {
  principalId: VISITOR,
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}

const otherVisitorActor: Actor = {
  principalId: OTHER,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const adminActor: Actor = {
  principalId: 'principal_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const memberActor: Actor = {
  principalId: 'principal_member' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

const serviceActor: Actor = {
  principalId: 'principal_service' as PrincipalId,
  role: 'member',
  principalType: 'service',
  segmentIds: new Set(),
}

const openConv: ConversationShape = { visitorPrincipalId: VISITOR, status: 'open' }
const closedConv: ConversationShape = { visitorPrincipalId: VISITOR, status: 'closed' }

describe('canViewConversation', () => {
  it('allows the owning visitor', () => {
    expect(canViewConversation(visitorActor, openConv).allowed).toBe(true)
    expect(canViewConversation(anonVisitorActor, openConv).allowed).toBe(true)
  })

  it('allows team members (admin + member) to view any conversation', () => {
    expect(canViewConversation(adminActor, openConv).allowed).toBe(true)
    expect(canViewConversation(memberActor, openConv).allowed).toBe(true)
  })

  it('denies a different visitor', () => {
    expect(canViewConversation(otherVisitorActor, openConv).allowed).toBe(false)
  })

  it('denies a fully anonymous actor with no principal', () => {
    expect(canViewConversation(ANONYMOUS_ACTOR, openConv).allowed).toBe(false)
  })
})

describe('canSendVisitorMessage', () => {
  it('allows the owning visitor (open or closed — replying reopens)', () => {
    expect(canSendVisitorMessage(visitorActor, openConv).allowed).toBe(true)
    expect(canSendVisitorMessage(visitorActor, closedConv).allowed).toBe(true)
    expect(canSendVisitorMessage(anonVisitorActor, openConv).allowed).toBe(true)
  })

  it('denies a non-owner', () => {
    expect(canSendVisitorMessage(otherVisitorActor, openConv).allowed).toBe(false)
  })

  it('denies an actor with no principal', () => {
    expect(canSendVisitorMessage(ANONYMOUS_ACTOR, openConv).allowed).toBe(false)
  })

  it('denies service principals', () => {
    const conv: ConversationShape = {
      visitorPrincipalId: serviceActor.principalId!,
      status: 'open',
    }
    expect(canSendVisitorMessage(serviceActor, conv).allowed).toBe(false)
  })
})

describe('canStartConversation', () => {
  it('allows any identified or anonymous visitor with a principal', () => {
    expect(canStartConversation(visitorActor).allowed).toBe(true)
    expect(canStartConversation(anonVisitorActor).allowed).toBe(true)
  })

  it('denies actors with no principal', () => {
    expect(canStartConversation(ANONYMOUS_ACTOR).allowed).toBe(false)
  })

  it('denies service principals', () => {
    expect(canStartConversation(serviceActor).allowed).toBe(false)
  })
})

describe('canActAsAgent', () => {
  it('allows team members only', () => {
    expect(canActAsAgent(adminActor).allowed).toBe(true)
    expect(canActAsAgent(memberActor).allowed).toBe(true)
  })

  it('denies portal users and anonymous visitors', () => {
    expect(canActAsAgent(visitorActor).allowed).toBe(false)
    expect(canActAsAgent(anonVisitorActor).allowed).toBe(false)
    expect(canActAsAgent(ANONYMOUS_ACTOR).allowed).toBe(false)
  })
})

describe('canDeleteMessage', () => {
  const msg = (over: Partial<Parameters<typeof canDeleteMessage>[1]> = {}) => ({
    senderType: 'agent' as const,
    authorPrincipalId: 'principal_admin' as PrincipalId,
    parent: 'conversation' as const,
    isInternal: false,
    ...over,
  })
  const ownVisitorMsg = msg({ senderType: 'visitor', authorPrincipalId: VISITOR })
  const contributor = (...keys: PermissionKey[]): Actor => ({
    principalId: 'principal_contrib' as PrincipalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(keys),
  })

  it("lets a moderator (conversation.manage) delete anyone's message", () => {
    expect(canDeleteMessage(adminActor, ownVisitorMsg, openConv).allowed).toBe(true)
    expect(canDeleteMessage(memberActor, msg(), openConv).allowed).toBe(true)
    expect(canDeleteMessage(memberActor, msg({ parent: 'ticket' }), null).allowed).toBe(true)
  })

  it('lets a teammate without manage delete only their own agent messages', () => {
    const me = contributor(PERMISSIONS.CONVERSATION_REPLY, PERMISSIONS.CONVERSATION_NOTE)
    const mine = msg({ authorPrincipalId: me.principalId })
    expect(canDeleteMessage(me, mine, openConv).allowed).toBe(true)
    expect(canDeleteMessage(me, { ...mine, isInternal: true }, openConv).allowed).toBe(true)
    expect(canDeleteMessage(me, msg(), openConv).allowed).toBe(false)
    expect(canDeleteMessage(me, ownVisitorMsg, openConv).allowed).toBe(false)
  })

  it('requires the permission that writes that kind of message', () => {
    const me = contributor(PERMISSIONS.CONVERSATION_REPLY)
    const mine = msg({ authorPrincipalId: me.principalId })
    expect(canDeleteMessage(me, { ...mine, isInternal: true }, openConv).allowed).toBe(false)
    expect(canDeleteMessage(me, { ...mine, parent: 'ticket' }, null).allowed).toBe(false)
    const ticketMe = contributor(PERMISSIONS.TICKET_REPLY)
    const ticketMine = msg({ authorPrincipalId: ticketMe.principalId, parent: 'ticket' })
    expect(canDeleteMessage(ticketMe, ticketMine, null).allowed).toBe(true)
  })

  it('never deletes a system line, even for a moderator', () => {
    expect(
      canDeleteMessage(adminActor, msg({ senderType: 'system', authorPrincipalId: null }), openConv)
        .allowed
    ).toBe(false)
  })

  it('lets the owning visitor delete their own visitor message', () => {
    expect(canDeleteMessage(visitorActor, ownVisitorMsg, openConv).allowed).toBe(true)
    expect(canDeleteMessage(anonVisitorActor, ownVisitorMsg, openConv).allowed).toBe(true)
  })

  it('denies a visitor deleting an agent message', () => {
    expect(canDeleteMessage(visitorActor, msg(), openConv).allowed).toBe(false)
  })

  it("denies a visitor deleting another visitor's message", () => {
    const othersMsg = msg({ senderType: 'visitor', authorPrincipalId: OTHER })
    expect(canDeleteMessage(visitorActor, othersMsg, openConv).allowed).toBe(false)
  })

  it('denies a non-team service principal via the visitor self-delete path', () => {
    // A service principal acting as the conversation owner must not slip
    // through the visitor branch (the team branch is role-gated separately).
    const serviceVisitor: Actor = {
      principalId: VISITOR,
      role: 'user',
      principalType: 'service',
      segmentIds: new Set(),
    }
    expect(canDeleteMessage(serviceVisitor, ownVisitorMsg, openConv).allowed).toBe(false)
  })
})

describe('canEditMessage', () => {
  const reply = { senderType: 'agent' as const, parent: 'conversation' as const, isInternal: false }
  const adminReply = { ...reply, authorPrincipalId: 'principal_admin' as PrincipalId }
  const withPermissions = (...keys: PermissionKey[]): Actor => ({
    ...adminActor,
    permissions: new Set(keys),
  })

  it('lets the author edit their own message', () => {
    expect(canEditMessage(adminActor, adminReply).allowed).toBe(true)
  })

  it("denies editing someone else's message, including a teammate's", () => {
    const visitorMsg = { ...reply, authorPrincipalId: VISITOR }
    expect(canEditMessage(adminActor, visitorMsg).allowed).toBe(false)
    expect(canEditMessage(memberActor, visitorMsg).allowed).toBe(false)
    expect(canEditMessage(visitorActor, adminReply).allowed).toBe(false)
  })

  it('denies a visitor editing their own message (no reply permission)', () => {
    expect(canEditMessage(visitorActor, { ...reply, authorPrincipalId: VISITOR }).allowed).toBe(
      false
    )
  })

  it('requires the permission that writes that kind of message', () => {
    const cases = [
      { parent: 'conversation', isInternal: false, key: PERMISSIONS.CONVERSATION_REPLY },
      { parent: 'conversation', isInternal: true, key: PERMISSIONS.CONVERSATION_NOTE },
      { parent: 'ticket', isInternal: false, key: PERMISSIONS.TICKET_REPLY },
      { parent: 'ticket', isInternal: true, key: PERMISSIONS.TICKET_NOTE },
    ] as const
    const all = cases.map((c) => c.key)
    for (const c of cases) {
      const msg = {
        senderType: 'agent' as const,
        authorPrincipalId: adminActor.principalId,
        parent: c.parent,
        isInternal: c.isInternal,
      }
      expect(canEditMessage(withPermissions(c.key), msg).allowed).toBe(true)
      const others = all.filter((k) => k !== c.key)
      expect(canEditMessage(withPermissions(...others), msg).allowed).toBe(false)
    }
  })

  it("denies a teammate's own customer-side or system row", () => {
    expect(canEditMessage(adminActor, { ...adminReply, senderType: 'visitor' }).allowed).toBe(false)
    expect(canEditMessage(adminActor, { ...adminReply, senderType: 'system' }).allowed).toBe(false)
  })

  it('denies a service principal and an author-less row', () => {
    const serviceAdmin: Actor = { ...adminActor, principalType: 'service' }
    expect(canEditMessage(serviceAdmin, adminReply).allowed).toBe(false)
    expect(canEditMessage(adminActor, { ...reply, authorPrincipalId: null }).allowed).toBe(false)
  })
})
