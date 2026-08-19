// @vitest-environment happy-dom
/**
 * AgentMessageBubble's read-only rendering of a Phase C conversational block
 * (PHASE-C-CONVERSATIONAL-UX-BRIEF.md): the agent inbox shows the prompt
 * bubble plus a passive summary — a chip row for buttons, a "waiting for"
 * caption for collect/collectReply, an inert emoji row for CSAT — and never
 * any interactive affordance (no button, no clickable emoji).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AgentMessageBubble } from '../message-bubble'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { WorkflowBlockPayload } from '@/lib/shared/db-types'

afterEach(cleanup)

function baseMessage(over: Partial<AgentConversationMessageDTO> = {}): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'agent',
    content: 'How can we help?',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: { principalId: 'principal_a' as never, displayName: 'Quinn', avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: true,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    block: null,
    blockReply: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...over,
  }
}

const buttonsBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_1',
  waiting: true,
  kind: 'buttons',
  options: [
    { key: 'yes', label: 'Yes please' },
    { key: 'no', label: 'No thanks' },
  ],
  allowTyping: false,
}

const collectBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_2',
  waiting: true,
  kind: 'collect',
  attributeKey: 'issue_type',
  fieldType: 'text',
  required: true,
}

const csatBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_3',
  waiting: true,
  kind: 'csat',
  allowTypingInterrupt: true,
  commentPrompt: '',
}

describe('AgentMessageBubble — conversational block read-only rendering', () => {
  it('renders a read-only chip row for a buttons block, with no button element', () => {
    render(<AgentMessageBubble message={baseMessage({ block: buttonsBlock })} />)
    expect(screen.getByText('Yes please')).toBeInTheDocument()
    expect(screen.getByText('No thanks')).toBeInTheDocument()
    // Chips are plain spans, not buttons — no interactive affordance.
    expect(screen.queryByRole('button', { name: 'Yes please' })).not.toBeInTheDocument()
  })

  it('renders a "waiting for" caption for a collect block', () => {
    render(<AgentMessageBubble message={baseMessage({ block: collectBlock })} />)
    expect(screen.getByText(/Waiting for: Issue type/)).toBeInTheDocument()
  })

  it('renders an inert emoji row for a csat block, with no clickable face', () => {
    render(<AgentMessageBubble message={baseMessage({ block: csatBlock })} />)
    expect(screen.getByText('😐')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /of 5/ })).not.toBeInTheDocument()
  })

  it('renders nothing extra for a message-kind block beyond the prompt bubble', () => {
    const messageBlock: WorkflowBlockPayload = {
      v: 1,
      runId: 'run_1',
      nodeId: 'node_4',
      waiting: false,
      kind: 'message',
    }
    render(<AgentMessageBubble message={baseMessage({ block: messageBlock })} />)
    expect(screen.getByText('How can we help?')).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument()
  })

  it('renders nothing extra for an ordinary (non-block) message', () => {
    render(<AgentMessageBubble message={baseMessage()} />)
    expect(screen.getByText('How can we help?')).toBeInTheDocument()
  })
})

// CF3: "Waiting for:" never resolved once the customer answered — the summary
// now takes the same derived BlockState the widget renders from and stops
// implying an answered/superseded block is still live.
describe('AgentMessageBubble — block summary answered-awareness (CF3)', () => {
  it('collect: shows "Waiting for" with no state (undefined — back-compat default)', () => {
    render(<AgentMessageBubble message={baseMessage({ block: collectBlock })} />)
    expect(screen.getByText(/Waiting for: Issue type/)).toBeInTheDocument()
  })

  it('collect: shows "Waiting for" while pending', () => {
    render(
      <AgentMessageBubble message={baseMessage({ block: collectBlock })} blockState="pending" />
    )
    expect(screen.getByText(/Waiting for: Issue type/)).toBeInTheDocument()
  })

  it('collect: flips to a quiet "Answered" once chosen', () => {
    render(
      <AgentMessageBubble message={baseMessage({ block: collectBlock })} blockState="chosen" />
    )
    expect(screen.getByText(/Answered: Issue type/)).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument()
  })

  it('collect: the caption disappears entirely once superseded', () => {
    render(
      <AgentMessageBubble message={baseMessage({ block: collectBlock })} blockState="superseded" />
    )
    expect(screen.queryByText(/Waiting for:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Answered:/)).not.toBeInTheDocument()
  })

  it('buttons: the chip row stops looking live once chosen or superseded', () => {
    const { unmount } = render(
      <AgentMessageBubble message={baseMessage({ block: buttonsBlock })} blockState="pending" />
    )
    expect(screen.getByText('Yes please').className).not.toMatch(/opacity-60/)
    unmount()

    render(
      <AgentMessageBubble message={baseMessage({ block: buttonsBlock })} blockState="chosen" />
    )
    // The dimming class lands on the row wrapper, not the chip itself.
    expect(screen.getByText('Yes please').closest('[aria-hidden]')?.className).toMatch(/opacity-60/)
  })
})
