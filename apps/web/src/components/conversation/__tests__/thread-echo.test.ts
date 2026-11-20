/**
 * A send changes the open thread once, whichever arrives first: the send's
 * response, or the stream's echo of it (a `conversation` frame and a `message`
 * frame). While this tab's own send to the conversation is in flight, the
 * echo is held and applied after the response, where it changes nothing. The
 * response's write, and the send's own state changes, then land together, so
 * the thread renders the same number of times in both orders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import type { ConversationDTO, ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import {
  appendSentAgentMessage,
  applyAgentThreadEvent,
  type AgentThreadCache,
} from '../events-reducer'
import { createOwnSendEchoHold } from '../thread-echo'

const id = 'conversation_1' as ConversationId
const key = conversationKeys.agentThread(id)
const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:05.000Z'

const conversation = (lastMessageAt: string) =>
  ({ id, lastMessageAt, lastMessagePreview: 'x', status: 'open' }) as unknown as ConversationDTO
const message = (mid: string, createdAt: string) =>
  ({
    id: mid as ConversationMessageId,
    conversationId: id,
    createdAt,
    content: 'hi',
    attachments: [],
    reactions: [],
  }) as unknown as ConversationMessageDTO

function setup() {
  const qc = new QueryClient()
  qc.setQueryData<AgentThreadCache>(key, {
    conversation: conversation(T0),
    messages: [message('m0', T0) as never],
  })
  /** Cache writes that changed the stored data's reference. */
  let changes = 0
  let last = qc.getQueryData(key)
  qc.getQueryCache().subscribe(() => {
    const now = qc.getQueryData(key)
    if (now !== last) changes += 1
    last = now
  })
  let sending = false
  const settled = new Set<() => void>()
  const write = (evts: Parameters<typeof applyAgentThreadEvent>[1][]) =>
    qc.setQueryData<AgentThreadCache>(key, (prev) =>
      evts.reduce<AgentThreadCache | undefined>((acc, e) => applyAgentThreadEvent(acc, e, id), prev)
    )
  const hold = createOwnSendEchoHold({
    isSending: () => sending,
    onSendSettled: (_id, done) => {
      settled.add(done)
      return () => settled.delete(done)
    },
    flush: (_id, evts) => write(evts),
    timeoutMs: 5_000,
  })
  /** What inbox.tsx does with a frame for the open conversation. */
  const frame = (evt: Parameters<typeof applyAgentThreadEvent>[1]) => {
    if (hold.hold(id, evt)) return
    write([evt])
  }
  /** What the thread does: the send starts, then its response lands. */
  const start = () => {
    sending = true
  }
  const respond = () => {
    qc.setQueryData<AgentThreadCache>(key, (prev) =>
      appendSentAgentMessage(prev, { conversation: conversation(T1), message: message('m1', T1) })
    )
    sending = false
    for (const done of [...settled]) done()
  }
  const sent = { kind: 'conversation' as const, conversation: conversation(T1) }
  const echo = { kind: 'message' as const, conversationId: id, message: message('m1', T1) }
  return {
    frame,
    start,
    respond,
    sent,
    echo,
    hold,
    changes: () => changes,
    data: () => qc.getQueryData<AgentThreadCache>(key),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a send and its echo change the open thread once', () => {
  it('response first: one change, and the echo keeps the same reference', () => {
    const t = setup()
    t.start()
    t.respond()
    const after = t.data()
    t.frame(t.sent)
    t.frame(t.echo)
    expect(t.changes()).toBe(1)
    expect(t.data()).toBe(after)
  })

  it('echo first: held until the response, then one change and the same reference', () => {
    const t = setup()
    t.start()
    t.frame(t.sent)
    t.frame(t.echo)
    expect(t.changes()).toBe(0)
    t.respond()
    expect(t.changes()).toBe(1)
    expect(t.data()?.messages.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(t.data()?.conversation.lastMessageAt).toBe(T1)
  })

  it('applies a change held during the send as soon as the send settles', () => {
    const t = setup()
    t.start()
    // Someone else's change to the conversation lands while the send is out.
    const moved = {
      kind: 'conversation' as const,
      conversation: { ...conversation(T1), status: 'snoozed' } as unknown as ConversationDTO,
    }
    t.frame(moved)
    t.respond()
    expect(t.data()?.conversation.status).toBe('snoozed')
  })

  it('applies frames at once when no send of this tab is in flight', () => {
    const t = setup()
    t.frame(t.sent)
    expect(t.changes()).toBe(1)
  })

  it('applies held frames after the timeout when the send never settles', () => {
    const t = setup()
    t.start()
    t.frame(t.echo)
    expect(t.changes()).toBe(0)
    vi.advanceTimersByTime(5_000)
    expect(t.data()?.messages.map((m) => m.id)).toEqual(['m0', 'm1'])
  })

  it('drops held frames when the owner goes away', () => {
    const t = setup()
    t.start()
    t.frame(t.echo)
    t.hold.cancel()
    vi.advanceTimersByTime(5_000)
    expect(t.changes()).toBe(0)
  })
})
