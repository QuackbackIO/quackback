import { describe, it, expect, vi, beforeEach } from 'vitest'

const { batchSpy, prefsSpy } = vi.hoisted(() => ({
  batchSpy: vi.fn().mockResolvedValue(['notif-id-1']),
  // No stored preferences for any principal in these tests — every
  // notification type defaults to "on", matching pre-matrix behavior.
  prefsSpy: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: batchSpy,
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: prefsSpy,
}))

const markNotifiedSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/conversation/sync-conversation-mentions', () => ({
  markConversationMentionsNotified: (...args: unknown[]) => markNotifiedSpy(...args),
}))

const isAnyAgentOnlineSpy = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: () => isAnyAgentOnlineSpy(),
}))

import { notificationHook } from '../handlers/notification'
import type { NotificationTarget } from '../handlers/notification'
import type { EventData } from '../types'

beforeEach(() => {
  batchSpy.mockClear()
  prefsSpy.mockClear()
  markNotifiedSpy.mockClear()
  isAnyAgentOnlineSpy.mockClear()
  isAnyAgentOnlineSpy.mockResolvedValue(false)
})

describe('notificationHook — post.mentioned', () => {
  it('creates an in-app notification with type post_mentioned', async () => {
    const event = {
      id: 'evt-1',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: {
        type: 'user',
        principalId: 'principal_mentioner',
        displayName: 'Alex',
      },
      data: {
        postId: 'post_123',
        postTitle: 'My post',
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_mentioner',
        excerpt: 'Hey, take a look',
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_target' as never] }

    const result = await notificationHook.run(event, target, {})
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledTimes(1)
    expect(batchSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: 'principal_target',
          type: 'post_mentioned',
          title: expect.stringContaining('Alex'),
          postId: 'post_123',
        }),
      ])
    )
  })

  it('renders title as "Anonymous user mentioned you" when actor has no displayName', async () => {
    const event = {
      id: 'evt-2',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
      data: {
        postId: 'post_123',
        postTitle: 'My post',
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_unknown',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    expect(batchSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining('Anonymous user') }),
      ])
    )
  })

  it('truncates a long post title in the notification body', async () => {
    const longTitle = 'a'.repeat(500)
    const event = {
      id: 'evt-3',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: longTitle,
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ body?: string }>
    expect(call[0].body?.length).toBeLessThanOrEqual(150)
  })

  it('includes postUrl and excerpt in the notification metadata', async () => {
    const event = {
      id: 'evt-4',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: 'context paragraph',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({
      postUrl: 'https://example.com/p/123',
      excerpt: 'context paragraph',
    })
  })

  it('carries actorName in metadata, same value used in the title', async () => {
    const event = {
      id: 'evt-6',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: 'context paragraph',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ actorName: 'Alex' })
  })

  it('falls back to Anonymous user for actorName when the actor has no displayName', async () => {
    const event = {
      id: 'evt-7',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_unknown',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ actorName: 'Anonymous user' })
  })
})

describe('notificationHook — comment.created', () => {
  it('carries actorName in metadata, mirroring commenterName', async () => {
    const event = {
      id: 'evt-8',
      type: 'comment.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Jordan' },
      data: {},
    } as EventData

    const config = {
      postId: 'post_1',
      postTitle: 'A post',
      boardSlug: 'feedback',
      postUrl: 'https://example.com/posts/post_1',
      commentId: 'post_comment_1',
      commenterName: 'Jordan',
      commentPreview: 'Nice work',
      isTeamMember: false,
    }

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, config)
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ commenterName: 'Jordan', actorName: 'Jordan' })
  })
})

// WO-3 slice 1: conversation/ticket assignment and assistant hand-off bells,
// routed through the same buildNotifications switch as every other event
// type. Target resolution (who ends up in principalIds) is covered by
// targets-assignment.test.ts; these assert the notification content the
// hook builds once a target already exists.
describe('notificationHook — conversation.assigned', () => {
  it('creates a "you were assigned" bell for the new assignee', async () => {
    const event = {
      id: 'evt-conv-assigned-1',
      type: 'conversation.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor', displayName: 'Jordan' },
      data: {
        conversation: {
          id: 'conversation_1',
          status: 'open',
          channel: 'messenger',
          priority: 'none',
        },
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_agent' as never] }
    const config = { conversationId: 'conversation_1', assignedAgentPrincipalId: 'principal_agent' }

    const result = await notificationHook.run(event, target, config)
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'conversation_assigned',
        title: 'You were assigned a conversation',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })

  // WO-3 slice 2 (ported characterization): replaces the deleted
  // notifyTeamAssigned direct write. The row shape is deliberately
  // DIFFERENT from the old direct write: type changes 'chat_message' ->
  // 'conversation_assigned' (this event's type), and the title text is
  // preserved verbatim ('A conversation was assigned to your team'). See
  // conversation-notify.test.ts's notifyTeamAssigned characterization
  // describe block for the pre-move behavior this replaces.
  it('titles a team member "assigned to your team", distinct from the direct assignee', async () => {
    const event = {
      id: 'evt-conv-assigned-2',
      type: 'conversation.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: {
          id: 'conversation_1',
          status: 'open',
          channel: 'messenger',
          priority: 'none',
        },
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target: NotificationTarget = {
      principalIds: ['principal_agent' as never, 'principal_teammate' as never],
    }
    const config = { conversationId: 'conversation_1', assignedAgentPrincipalId: 'principal_agent' }

    await notificationHook.run(event, target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toEqual([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'conversation_assigned',
        title: 'You were assigned a conversation',
      }),
      expect.objectContaining({
        principalId: 'principal_teammate',
        type: 'conversation_assigned',
        title: 'A conversation was assigned to your team',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })
})

describe('notificationHook — ticket.assigned', () => {
  it('titles the direct assignee "you were assigned" and everyone else "your team"', async () => {
    const event = {
      id: 'evt-ticket-assigned-1',
      type: 'ticket.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target: NotificationTarget = {
      principalIds: ['principal_agent' as never, 'principal_teammate' as never],
    }
    const config = { ticketId: 'ticket_1', assignedPrincipalId: 'principal_agent' }

    await notificationHook.run(event, target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toEqual([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'ticket_assigned',
        title: 'You were assigned a ticket',
        metadata: { ticketId: 'ticket_1' },
      }),
      expect.objectContaining({
        principalId: 'principal_teammate',
        type: 'ticket_assigned',
        title: 'A ticket was assigned to your team',
        metadata: { ticketId: 'ticket_1' },
      }),
    ])
  })
})

// WO-3 slice 4 (ported characterization): replaces the deleted inline
// createNotification block in ticket.service.ts's setTicketStatus. Title/body
// copy is preserved BYTE-FOR-BYTE from the old direct write — see
// domains/tickets/__tests__/ticket.service.test.ts's now-adjacent comment —
// the resolver (events/__tests__/targets-ticket-status.test.ts) is what
// changed: it now resolves stage labels itself rather than the service
// passing them in already-formatted.
describe('notificationHook — ticket.status_changed', () => {
  function makeEvent(): EventData {
    return {
      id: 'evt-ticket-status-1',
      type: 'ticket.status_changed',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        previousStatus: 'open',
        newStatus: 'closed',
        stage: 'resolved',
        previousStage: 'received',
        requesterPrincipalId: 'principal_requester',
        title: 'Cannot log in',
      },
    } as EventData
  }

  it('titles + bodies a from/to crossing exactly like the old direct write', async () => {
    const target: NotificationTarget = { principalIds: ['principal_requester' as never] }
    const config = {
      ticketId: 'ticket_1',
      title: 'Cannot log in',
      stageLabel: 'Resolved',
      previousStageLabel: 'Received',
    }

    await notificationHook.run(makeEvent(), target, config)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_requester',
        type: 'ticket_status_changed',
        title: 'Cannot log in is now Resolved',
        body: 'Moved from Received to Resolved',
        metadata: { ticketId: 'ticket_1' },
      }),
    ])
  })

  it('falls back to a generic body when there was no prior stage', async () => {
    const target: NotificationTarget = { principalIds: ['principal_requester' as never] }
    const config = {
      ticketId: 'ticket_1',
      title: 'Cannot log in',
      stageLabel: 'Resolved',
      previousStageLabel: null,
    }

    await notificationHook.run(makeEvent(), target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch[0]).toMatchObject({
      title: 'Cannot log in is now Resolved',
      body: 'Open the ticket to see the latest update.',
    })
  })
})

describe('notificationHook — ticket.replied (watchers)', () => {
  function makeEvent(): EventData {
    return {
      id: 'evt-ticket-replied-1',
      type: 'ticket.replied',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        messageId: 'conversation_message_1',
        content: 'Fix is queued for the next patch.',
        attachments: null,
        senderType: 'agent',
        title: 'Cannot log in',
        authorName: 'Sarah',
        requesterPrincipalId: 'principal_requester',
      },
    } as EventData
  }
  const config = {
    ticketId: 'ticket_1',
    title: 'Cannot log in',
    authorName: 'Sarah',
    preview: 'Fix is queued for the next patch.',
    requesterPrincipalId: 'principal_requester',
  }

  it('builds ticket_replied rows for every recipient with per-recipient audience metadata', async () => {
    const target: NotificationTarget = {
      principalIds: ['principal_requester' as never, 'principal_agent_1' as never],
    }
    await notificationHook.run(makeEvent(), target, config)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_requester',
        type: 'ticket_replied',
        title: 'Sarah replied on Cannot log in',
        body: 'Fix is queued for the next patch.',
        metadata: { ticketId: 'ticket_1', actorName: 'Sarah', audience: 'portal' },
      }),
      expect.objectContaining({
        principalId: 'principal_agent_1',
        type: 'ticket_replied',
        metadata: { ticketId: 'ticket_1', actorName: 'Sarah', audience: 'admin' },
      }),
    ])
  })

  it('drops a principal whose matrix turns ticket_replied inApp off (per-type preference)', async () => {
    prefsSpy.mockResolvedValueOnce(
      new Map([
        ['principal_agent_1', { emailMuted: false, matrix: { ticket_replied: { inApp: false } } }],
      ])
    )
    const target: NotificationTarget = {
      principalIds: ['principal_requester' as never, 'principal_agent_1' as never],
    }
    await notificationHook.run(makeEvent(), target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({ principalId: 'principal_requester' })
  })
})

describe('notificationHook — ticket.note_added (agent watchers)', () => {
  it('builds admin-audience ticket_note_added rows', async () => {
    const event = {
      id: 'evt-ticket-note-1',
      type: 'ticket.note_added',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        messageId: 'conversation_message_2',
        content: 'Repro confirmed on staging.',
        attachments: null,
        senderType: 'agent',
        title: 'Cannot log in',
        authorName: 'Marco',
      },
    } as EventData
    const target: NotificationTarget = { principalIds: ['principal_agent_1' as never] }
    const config = {
      ticketId: 'ticket_1',
      title: 'Cannot log in',
      authorName: 'Marco',
      preview: 'Repro confirmed on staging.',
    }

    await notificationHook.run(event, target, config)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_agent_1',
        type: 'ticket_note_added',
        title: 'Marco added an internal note on Cannot log in',
        body: 'Repro confirmed on staging.',
        metadata: { ticketId: 'ticket_1', actorName: 'Marco', audience: 'admin' },
      }),
    ])
  })
})

describe('notificationHook — ticket.status_changed (watcher audience)', () => {
  it('marks the requester portal and agent watchers admin when the config carries the requester', async () => {
    const event = {
      id: 'evt-ticket-status-2',
      type: 'ticket.status_changed',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        previousStatus: 'open',
        newStatus: 'closed',
        stage: 'resolved',
        previousStage: 'received',
        requesterPrincipalId: 'principal_requester',
        title: 'Cannot log in',
      },
    } as EventData
    const target: NotificationTarget = {
      principalIds: ['principal_requester' as never, 'principal_agent_1' as never],
    }
    const config = {
      ticketId: 'ticket_1',
      title: 'Cannot log in',
      stageLabel: 'Resolved',
      previousStageLabel: 'Received',
      requesterPrincipalId: 'principal_requester',
    }

    await notificationHook.run(event, target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch[0]).toMatchObject({
      principalId: 'principal_requester',
      metadata: { ticketId: 'ticket_1', audience: 'portal' },
    })
    expect(batch[1]).toMatchObject({
      principalId: 'principal_agent_1',
      metadata: { ticketId: 'ticket_1', audience: 'admin' },
    })
  })
})

describe('notificationHook — assistant.handed_off', () => {
  it('creates a hand-off bell with the truncated reason as the body', async () => {
    const event = {
      id: 'evt-handoff-1',
      type: 'assistant.handed_off',
      timestamp: new Date().toISOString(),
      actor: { type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' },
      data: { conversationId: 'conversation_1', reason: 'Customer asked for a human' },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_agent' as never] }
    const config = { conversationId: 'conversation_1', reason: 'Customer asked for a human' }

    await notificationHook.run(event, target, config)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'assistant_handed_off',
        title: 'Quinn handed off a conversation',
        body: 'Customer asked for a human',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })
})

// WO-3 slice 3 (ported characterization): replaces the deleted direct
// createNotificationsBatch call in sync-conversation-mentions.ts. Row shape
// (type 'chat_mention', title, body, metadata) is IDENTICAL to the old direct
// write — see conversation/__tests__/sync-conversation-mentions.test.ts for
// the pre-move recipient/dispatch characterization this ports from.
describe('notificationHook — conversation.note_mentioned', () => {
  function makeEvent(): EventData {
    return {
      id: 'evt-note-mentioned-1',
      type: 'conversation.note_mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_author', displayName: 'Jane' },
      data: {
        conversationId: 'conversation_1',
        conversationMessageId: 'conversation_msg_1',
        mentionedPrincipalIds: ['principal_one', 'principal_two'],
        authorName: 'Jane',
        preview: 'please take a look',
      },
    } as EventData
  }

  it('creates a chat_mention bell matching the pre-move row shape', async () => {
    const target: NotificationTarget = {
      principalIds: ['principal_one' as never, 'principal_two' as never],
    }
    const config = {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      authorName: 'Jane',
      preview: 'please take a look',
    }

    const result = await notificationHook.run(makeEvent(), target, config)
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_one',
        type: 'chat_mention',
        title: 'Jane mentioned you in a conversation',
        body: 'please take a look',
        metadata: { conversationId: 'conversation_1', actorName: 'Jane' },
      }),
      expect.objectContaining({
        principalId: 'principal_two',
        type: 'chat_mention',
        title: 'Jane mentioned you in a conversation',
      }),
    ])
  })

  it('stamps the notifiedAt watermark AFTER the batch insert succeeds, for exactly the delivered principals', async () => {
    const target: NotificationTarget = {
      principalIds: ['principal_one' as never, 'principal_two' as never],
    }
    const config = {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      authorName: 'Jane',
      preview: 'please take a look',
    }

    await notificationHook.run(makeEvent(), target, config)
    expect(markNotifiedSpy).toHaveBeenCalledTimes(1)
    expect(markNotifiedSpy).toHaveBeenCalledWith('conversation_msg_1', [
      'principal_one',
      'principal_two',
    ])
    // Called after the batch, not before.
    const batchOrder = batchSpy.mock.invocationCallOrder[0]
    const markOrder = markNotifiedSpy.mock.invocationCallOrder[0]
    expect(batchOrder).toBeLessThan(markOrder)
  })

  it('never stamps notifiedAt when the batch insert throws (no alert-that-never-happened watermark)', async () => {
    batchSpy.mockRejectedValueOnce(new Error('db down'))
    const target: NotificationTarget = { principalIds: ['principal_one' as never] }
    const config = {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      authorName: 'Jane',
      preview: 'please take a look',
    }

    const result = await notificationHook.run(makeEvent(), target, config)
    expect(result.success).toBe(false)
    expect(markNotifiedSpy).not.toHaveBeenCalled()
  })

  it('excludes a preference-gated-out principal from the watermark too', async () => {
    prefsSpy.mockResolvedValueOnce(
      new Map([
        ['principal_two', { emailMuted: false, matrix: { chat_mention: { inApp: false } } }],
      ])
    )
    const target: NotificationTarget = {
      principalIds: ['principal_one' as never, 'principal_two' as never],
    }
    const config = {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      authorName: 'Jane',
      preview: 'please take a look',
    }

    await notificationHook.run(makeEvent(), target, config)
    expect(markNotifiedSpy).toHaveBeenCalledWith('conversation_msg_1', ['principal_one'])
  })
})

// WO-3 slice 5 (ported characterization, riskiest slice — replaces
// notifyVisitorMessage's deleted team-bell block). Row shape (type
// 'chat_message', title, body, metadata) is IDENTICAL to the old direct
// write; what's NEW here is the anti-spam presence gate itself, which used
// to run at request time inside notifyVisitorMessage and now runs in this
// worker-side hook instead — see conversation-notify.test.ts's adjacent
// comment for the pre-move behavior this replaces.
describe('notificationHook — message.created', () => {
  function makeEvent(isFirstMessage: boolean): EventData {
    return {
      id: 'evt-message-created-1',
      type: 'message.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_visitor' },
      data: {
        message: {
          id: 'conversation_msg_1',
          conversationId: 'conversation_1',
          senderType: 'visitor',
          authorPrincipalId: 'principal_visitor',
          authorName: 'Jane',
          authorEmail: null,
          content: 'urgent please help',
          createdAt: new Date().toISOString(),
        },
        conversation: {
          id: 'conversation_1',
          status: 'open',
          channel: 'messenger',
          priority: 'none',
        },
        isFirstMessage,
      },
    } as EventData
  }

  const config = {
    conversationId: 'conversation_1',
    authorName: 'Jane',
    preview: 'urgent please help',
  }
  const target: NotificationTarget = {
    principalIds: ['principal_admin' as never, 'principal_member' as never],
  }

  it('bells the team on the first message even when an agent is online', async () => {
    isAnyAgentOnlineSpy.mockResolvedValue(true)

    const result = await notificationHook.run(makeEvent(true), target, {
      ...config,
      isFirstMessage: true,
    })
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_admin',
        type: 'chat_message',
        title: 'New message from Jane',
        body: 'urgent please help',
        metadata: { conversationId: 'conversation_1', actorName: 'Jane' },
      }),
      expect.objectContaining({ principalId: 'principal_member', type: 'chat_message' }),
    ])
  })

  it('gates out (success:true, no batch) a non-first message while an agent is online', async () => {
    isAnyAgentOnlineSpy.mockResolvedValue(true)

    const result = await notificationHook.run(makeEvent(false), target, {
      ...config,
      isFirstMessage: false,
    })
    expect(result).toEqual({ success: true })
    expect(result.shouldRetry).toBeUndefined()
    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('bells the team for a non-first message when no agent is online', async () => {
    isAnyAgentOnlineSpy.mockResolvedValue(false)

    const result = await notificationHook.run(makeEvent(false), target, {
      ...config,
      isFirstMessage: false,
    })
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledTimes(1)
  })

  it('never calls isAnyAgentOnline on the first message (skips the gate entirely)', async () => {
    await notificationHook.run(makeEvent(true), target, { ...config, isFirstMessage: true })
    expect(isAnyAgentOnlineSpy).not.toHaveBeenCalled()
  })
})

describe('notificationHook — changelog.published', () => {
  it('includes changelogId in the notification metadata', async () => {
    const event = {
      id: 'evt-5',
      type: 'changelog.published',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        changelog: {
          id: 'changelog_1',
          title: 'New feature',
          contentPreview: 'We shipped a thing',
          publishedAt: new Date().toISOString(),
          linkedPostCount: 0,
        },
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_target' as never] }
    const config = {
      changelogId: 'changelog_1',
      changelogTitle: 'New feature',
      changelogUrl: 'https://example.com/changelog',
      contentPreview: 'We shipped a thing',
    }

    await notificationHook.run(event, target, config)
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ changelogId: 'changelog_1' })
  })
})
