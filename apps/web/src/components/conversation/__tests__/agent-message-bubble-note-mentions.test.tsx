// @vitest-environment happy-dom
/**
 * Editing an internal note uses the same @mention list as writing one: the
 * editor is told which inbox item the note is on, so teammates who cannot see
 * that item come back marked "No access" and cannot be picked. A reply's edit
 * keeps the plain list.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: { mentionItem?: { kind: string; id: string } }) => (
    <div data-testid="edit-editor" data-mention-item={JSON.stringify(props.mentionItem ?? null)} />
  ),
}))

import { AgentMessageBubble } from '../message-bubble'

afterEach(cleanup)

const ITEM = { kind: 'conversation' as const, id: 'conversation_1' }

function message(over: Partial<AgentConversationMessageDTO>): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'agent',
    content: 'Looping in the team',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: { principalId: 'principal_me' as never, displayName: 'Me', avatarUrl: null },
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

function openEditor(m: AgentConversationMessageDTO) {
  render(
    <AgentMessageBubble canEdit onEdit={vi.fn(async () => {})} mentionItem={ITEM} message={m} />
  )
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit message' }))
  return JSON.parse(screen.getByTestId('edit-editor').getAttribute('data-mention-item') ?? 'null')
}

describe('editing a message: the @mention list', () => {
  it('marks access for the item when the message is an internal note', () => {
    expect(openEditor(message({ isInternal: true }))).toEqual(ITEM)
  })

  it('keeps the plain list for a reply', () => {
    expect(openEditor(message({ isInternal: false }))).toBeNull()
  })
})
