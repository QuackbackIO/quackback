// @vitest-environment happy-dom
/**
 * AgentMessageBubble's P2-D.1 inbox-translation display: absent `translation`
 * prop is a pure pin (zero behavior change when the feature is inactive);
 * present, it renders the translated text by default with a "Show original"
 * toggle, flips to the original on click, and reads "Show translation" once
 * showing the original.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AgentMessageBubble, VisitorMessageBubble } from '../message-bubble'
import { canDeleteAgentMessage, canEditAgentMessage } from '../message-edit'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'

afterEach(cleanup)

function baseMessage(over: Partial<AgentConversationMessageDTO> = {}): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'visitor',
    content: 'Bonjour, mon colis est en retard.',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: { principalId: 'principal_v' as never, displayName: 'Vic', avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...over,
  }
}

describe('AgentMessageBubble — edited mark', () => {
  it('shows a small (edited) note after the time once the body has been edited', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          editedAt: '2026-07-01T01:00:00.000Z',
        })}
      />
    )
    expect(screen.getByText('(edited)')).toBeInTheDocument()
    expect(screen.getByTitle(/^Edited /)).toBeInTheDocument()
  })

  it('omits the note on a message that was never edited', () => {
    render(<AgentMessageBubble message={baseMessage()} />)
    expect(screen.queryByText('(edited)')).not.toBeInTheDocument()
  })

  it('renders the visitor-side mark from the localized label it is given', () => {
    render(
      <VisitorMessageBubble side="peer" content="Hi" time="10:00" editedLabel="(bearbeitet)" />
    )
    expect(screen.getByText('(bearbeitet)')).toBeInTheDocument()
    cleanup()
    render(<VisitorMessageBubble side="peer" content="Hi" time="10:00" />)
    expect(screen.queryByText('(edited)')).not.toBeInTheDocument()
  })

  it('opens an inline editor from the message menu', () => {
    const onEdit = vi.fn(async () => {})
    render(
      <AgentMessageBubble
        canEdit
        onEdit={onEdit}
        message={baseMessage({
          senderType: 'agent',
          content: 'Hello there',
          author: { principalId: 'principal_me' as never, displayName: 'James', avatarUrl: null },
        })}
      />
    )
    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit message' }))
    expect(screen.getByTestId('message-edit-form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('message-edit-form')).not.toBeInTheDocument()
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it("offers Edit message only for the author's own ordinary message", () => {
    const own = baseMessage({
      senderType: 'agent',
      author: { principalId: 'principal_me' as never, displayName: 'James', avatarUrl: null },
    })
    const all = new Set(Object.values(PERMISSIONS))
    expect(canEditAgentMessage(own, 'principal_me', all)).toBe(true)
    expect(canEditAgentMessage(own, 'principal_other', all)).toBe(false)
    expect(canEditAgentMessage({ ...own, isAssistant: true }, 'principal_me', all)).toBe(false)
    expect(canEditAgentMessage({ ...own, senderType: 'system' }, 'principal_me', all)).toBe(false)
    // A teammate who wrote as a customer does not get to edit that row.
    expect(canEditAgentMessage({ ...own, senderType: 'visitor' }, 'principal_me', all)).toBe(false)
    expect(
      canEditAgentMessage(
        { ...own, block: { kind: 'buttons', prompt: 'Pick', options: [] } as never },
        'principal_me',
        all
      )
    ).toBe(false)
  })

  it('hides Edit message without the permission that writes that kind of message', () => {
    const own = baseMessage({
      senderType: 'agent',
      author: { principalId: 'principal_me' as never, displayName: 'James', avatarUrl: null },
    })
    const ticketReply = { ...own, conversationId: null, ticketId: 'ticket_1' as never }
    const note = { ...own, isInternal: true }
    const only = (key: PermissionKey) => new Set([key])
    expect(canEditAgentMessage(ticketReply, 'principal_me', only(PERMISSIONS.TICKET_REPLY))).toBe(
      true
    )
    expect(
      canEditAgentMessage(ticketReply, 'principal_me', only(PERMISSIONS.CONVERSATION_REPLY))
    ).toBe(false)
    expect(canEditAgentMessage(note, 'principal_me', only(PERMISSIONS.CONVERSATION_NOTE))).toBe(
      true
    )
    expect(canEditAgentMessage(note, 'principal_me', only(PERMISSIONS.CONVERSATION_REPLY))).toBe(
      false
    )
  })
})

describe('canDeleteAgentMessage', () => {
  const own = baseMessage({
    senderType: 'agent',
    author: { principalId: 'principal_me' as never, displayName: 'James', avatarUrl: null },
  })
  const replier = new Set<PermissionKey>([PERMISSIONS.CONVERSATION_REPLY])
  const moderator = new Set<PermissionKey>([PERMISSIONS.CONVERSATION_MANAGE])

  it('offers Delete on your own agent message', () => {
    expect(canDeleteAgentMessage(own, 'principal_me', replier)).toBe(true)
    expect(canDeleteAgentMessage(own, 'principal_other', replier)).toBe(false)
    expect(canDeleteAgentMessage(baseMessage(), 'principal_v', replier)).toBe(false)
  })

  it("offers Delete on anyone's message to a moderator, never on a system line", () => {
    expect(canDeleteAgentMessage(own, 'principal_other', moderator)).toBe(true)
    expect(canDeleteAgentMessage(baseMessage(), 'principal_other', moderator)).toBe(true)
    expect(
      canDeleteAgentMessage({ ...own, senderType: 'system' }, 'principal_other', moderator)
    ).toBe(false)
  })

  it('hides Delete in the menu unless allowed', () => {
    const { unmount } = render(<AgentMessageBubble message={own} />)
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    unmount()
    render(<AgentMessageBubble message={own} canDelete />)
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('AgentMessageBubble: removed messages', () => {
  const deleted = () =>
    baseMessage({
      content: 'My password is hunter2',
      deletedAt: '2026-07-01T01:00:00.000Z',
      deletedByName: 'Vic',
    })

  it('shows a placeholder the team can open', () => {
    render(<AgentMessageBubble message={deleted()} />)
    expect(screen.getByText('Deleted by Vic')).toBeInTheDocument()
    expect(screen.queryByText('My password is hunter2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('My password is hunter2')).toBeInTheDocument()
    // A removed message has no actions menu.
    expect(screen.queryByLabelText('More actions')).not.toBeInTheDocument()
  })

  it('offers Redact on the placeholder to a moderator only', () => {
    const onRedact = vi.fn()
    const { unmount } = render(<AgentMessageBubble message={deleted()} />)
    expect(screen.queryByRole('button', { name: 'Redact' })).not.toBeInTheDocument()
    unmount()
    render(<AgentMessageBubble message={deleted()} canRedact onRedact={onRedact} />)
    fireEvent.click(screen.getByRole('button', { name: 'Redact' }))
    expect(onRedact).toHaveBeenCalledWith(deleted().id)
  })

  it('has nothing left to open once redacted', () => {
    render(
      <AgentMessageBubble
        message={{
          ...deleted(),
          content: '',
          redactedAt: '2026-07-01T02:00:00.000Z',
          redactedByName: 'Ava',
        }}
        canRedact
        onRedact={vi.fn()}
      />
    )
    expect(screen.getByText('Redacted by Ava')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redact' })).not.toBeInTheDocument()
  })

  it('opens earlier versions from the (edited) mark', async () => {
    const load = vi.fn(async () => [
      { id: 'e1', content: 'Hello', editedAt: '2026-07-01T01:00:00.000Z', editorName: 'Ava' },
    ])
    render(
      <AgentMessageBubble
        message={baseMessage({ senderType: 'agent', editedAt: '2026-07-01T01:00:00.000Z' })}
        loadEditHistory={load}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '(edited)' }))
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('VisitorMessageBubble: deleting your own message', () => {
  const labels = { action: 'Delete', confirm: 'Delete this message?', cancel: 'Cancel' }

  it('asks before deleting, and Cancel keeps the message', () => {
    const onDelete = vi.fn()
    render(
      <VisitorMessageBubble side="self" content="Hi" onDelete={onDelete} deleteLabels={labels} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this message?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('offers no delete on a team message', () => {
    render(
      <VisitorMessageBubble side="peer" content="Hi" onDelete={vi.fn()} deleteLabels={labels} />
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

describe('AgentMessageBubble — inbox translation (P2-D.1)', () => {
  it('renders the plain content with no toggle when translation is absent (pin: unchanged default)', () => {
    render(<AgentMessageBubble message={baseMessage()} />)
    expect(screen.getByText('Bonjour, mon colis est en retard.')).toBeInTheDocument()
    expect(screen.queryByText(/Translated from/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show original/)).not.toBeInTheDocument()
  })

  it('shows the translated text by default with a "Translated from … Show original" toggle', () => {
    const onToggleOriginal = () => {}
    render(
      <AgentMessageBubble
        message={baseMessage()}
        translation={{
          label: 'Translated from French',
          translatedContent: 'Hello, my package is late.',
          originalContent: 'Bonjour, mon colis est en retard.',
          showingOriginal: false,
          onToggleOriginal,
        }}
      />
    )
    expect(screen.getByText('Hello, my package is late.')).toBeInTheDocument()
    expect(screen.queryByText('Bonjour, mon colis est en retard.')).not.toBeInTheDocument()
    expect(screen.getByText('Translated from French · Show original')).toBeInTheDocument()
  })

  it('clicking the toggle calls onToggleOriginal', () => {
    let toggled = false
    render(
      <AgentMessageBubble
        message={baseMessage()}
        translation={{
          label: 'Translated from French',
          translatedContent: 'Hello, my package is late.',
          originalContent: 'Bonjour, mon colis est en retard.',
          showingOriginal: false,
          onToggleOriginal: () => {
            toggled = true
          },
        }}
      />
    )
    fireEvent.click(screen.getByText('Translated from French · Show original'))
    expect(toggled).toBe(true)
  })

  it('shows the original content and "Show translation" once toggled', () => {
    render(
      <AgentMessageBubble
        message={baseMessage()}
        translation={{
          label: 'Translated from French',
          translatedContent: 'Hello, my package is late.',
          originalContent: 'Bonjour, mon colis est en retard.',
          showingOriginal: true,
          onToggleOriginal: () => {},
        }}
      />
    )
    expect(screen.getByText('Bonjour, mon colis est en retard.')).toBeInTheDocument()
    expect(screen.queryByText('Hello, my package is late.')).not.toBeInTheDocument()
    expect(screen.getByText('Show translation')).toBeInTheDocument()
  })

  it('renders an outgoing translated reply\'s "Translated to …" toggle', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({ senderType: 'agent', content: 'Bonjour, comment puis-je aider?' })}
        translation={{
          label: 'Translated to French',
          translatedContent: 'Bonjour, comment puis-je aider?',
          originalContent: 'Hi, how can I help?',
          showingOriginal: false,
          onToggleOriginal: () => {},
        }}
      />
    )
    expect(screen.getByText('Bonjour, comment puis-je aider?')).toBeInTheDocument()
    expect(screen.getByText('Translated to French · Show original')).toBeInTheDocument()
  })
})

describe('AgentMessageBubble — channel delivery ticks', () => {
  it('shows a sending tick on a pending GitHub reply', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          content: 'the fix is out',
          channelDelivery: { status: 'pending', channel: 'github', at: '2026-08-29T12:00:00.000Z' },
        })}
      />
    )
    expect(screen.getByLabelText('Sending to GitHub')).toBeInTheDocument()
  })

  it('shows a sent tick once GitHub accepted the comment', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          content: 'the fix is out',
          channelDelivery: {
            status: 'sent',
            channel: 'github',
            at: '2026-08-29T12:00:01.000Z',
            externalId: '444',
          },
        })}
      />
    )
    expect(screen.getByLabelText('Sent to GitHub')).toBeInTheDocument()
  })

  it('shows the failure reason when the comment did not land', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          content: 'the fix is out',
          channelDelivery: {
            status: 'failed',
            channel: 'github',
            at: '2026-08-29T12:00:01.000Z',
            error: 'GitHub is not connected.',
          },
        })}
      />
    )
    expect(screen.getByLabelText('GitHub is not connected.')).toBeInTheDocument()
  })

  it('does not show ticks on visitor messages or notes', () => {
    const { rerender } = render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'visitor',
          channelDelivery: { status: 'sent', channel: 'github', at: 't' },
        })}
      />
    )
    expect(screen.queryByLabelText('Sent to GitHub')).not.toBeInTheDocument()
    rerender(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          isInternal: true,
          content: 'internal',
          channelDelivery: { status: 'pending', channel: 'github', at: 't' },
        })}
      />
    )
    expect(screen.queryByLabelText('Sending to GitHub')).not.toBeInTheDocument()
  })

  it('exposes a retry control only on a failed GitHub send', () => {
    const onRetry = vi.fn()
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          content: 'the fix is out',
          channelDelivery: {
            status: 'failed',
            channel: 'github',
            at: '2026-08-29T12:00:01.000Z',
            error: 'GitHub is not connected.',
          },
        })}
        onRetryChannelDelivery={onRetry}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'GitHub is not connected. Retry' }))
    expect(onRetry).toHaveBeenCalledWith('conversation_msg_1')
  })

  it('does not expose retry on a sent GitHub tick', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          senderType: 'agent',
          content: 'the fix is out',
          channelDelivery: {
            status: 'sent',
            channel: 'github',
            at: '2026-08-29T12:00:01.000Z',
            externalId: '444',
          },
        })}
        onRetryChannelDelivery={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Sent to GitHub')).toBeInTheDocument()
  })
})

describe('AgentMessageBubble — pair-thread provenance (convergence Phase 2)', () => {
  it('labels a legacy ticket-parented row "via ticket thread" in a pair view', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          conversationId: null,
          ticketId: 'ticket_1' as AgentConversationMessageDTO['ticketId'],
        })}
        ticketProvenance
      />
    )
    expect(screen.getByText('· via ticket thread')).toBeInTheDocument()
  })

  it('never labels a conversation-parented row, even in a pair view', () => {
    render(<AgentMessageBubble message={baseMessage()} ticketProvenance />)
    expect(screen.queryByText(/via ticket thread/)).not.toBeInTheDocument()
  })

  it('never labels without the pair-view flag (a standalone ticket thread stays clean)', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          conversationId: null,
          ticketId: 'ticket_1' as AgentConversationMessageDTO['ticketId'],
        })}
      />
    )
    expect(screen.queryByText(/via ticket thread/)).not.toBeInTheDocument()
  })

  it('never labels an internal note (its own "Internal note" marker says what it is)', () => {
    render(
      <AgentMessageBubble
        message={baseMessage({
          conversationId: null,
          ticketId: 'ticket_1' as AgentConversationMessageDTO['ticketId'],
          senderType: 'agent',
          isInternal: true,
        })}
        ticketProvenance
      />
    )
    expect(screen.getByText('Internal note')).toBeInTheDocument()
    expect(screen.queryByText(/via ticket thread/)).not.toBeInTheDocument()
  })
})
