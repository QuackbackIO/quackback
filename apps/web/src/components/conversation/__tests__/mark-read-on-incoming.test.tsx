// @vitest-environment happy-dom
/**
 * useMarkReadOnIncoming writes the caller's read watermark when the newest
 * message came from the other side. A thread whose watermark already covers
 * that message has nothing to clear, so opening it again writes nothing (each
 * write is broadcast to every open inbox, which then refreshes its list).
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ConversationId } from '@quackback/ids'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import {
  portalVisitorRpc,
  VisitorSurfaceRpcProvider,
  type VisitorSurfaceRpc,
} from '@/lib/client/visitor-surface-rpc'
import { useMarkReadOnIncoming } from '../thread'

afterEach(cleanup)

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId

function message(id: string, createdAt: string): ConversationMessageDTO {
  return { id, senderType: 'visitor', createdAt } as unknown as ConversationMessageDTO
}

function setup(initial: { messages: ConversationMessageDTO[]; readThrough?: string | null }) {
  const markConversationRead = vi.fn().mockResolvedValue({ ok: true })
  const onMarked = vi.fn()
  const rpc = { ...portalVisitorRpc, markConversationRead } as unknown as VisitorSurfaceRpc
  const wrapper = ({ children }: { children: ReactNode }) => (
    <VisitorSurfaceRpcProvider value={rpc}>{children}</VisitorSurfaceRpcProvider>
  )
  const hook = renderHook(
    (props: { messages: ConversationMessageDTO[]; readThrough?: string | null }) =>
      useMarkReadOnIncoming({
        conversationId: CONVERSATION,
        messages: props.messages,
        whenLastFrom: 'visitor',
        readThrough: props.readThrough,
        onMarked,
      }),
    { wrapper, initialProps: initial }
  )
  return { hook, markConversationRead, onMarked }
}

describe('useMarkReadOnIncoming', () => {
  it('marks a thread read whose newest message is past the watermark', async () => {
    const { markConversationRead, onMarked } = setup({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: '2026-07-01T10:00:00.000Z',
    })
    await waitFor(() => expect(onMarked).toHaveBeenCalled())
    expect(markConversationRead).toHaveBeenCalledWith({ data: { conversationId: CONVERSATION } })
  })

  it('marks a never-read thread read', async () => {
    const { markConversationRead } = setup({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: null,
    })
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(1))
  })

  it('writes nothing when the watermark already covers the newest message', async () => {
    const { markConversationRead } = setup({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: '2026-07-02T10:00:00.000Z',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(markConversationRead).not.toHaveBeenCalled()
  })

  it('marks read again when a newer message arrives in a read thread', async () => {
    const { hook, markConversationRead } = setup({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: '2026-07-02T10:00:00.000Z',
    })
    hook.rerender({
      messages: [
        message('m1', '2026-07-02T10:00:00.000Z'),
        message('m2', '2026-07-02T11:00:00.000Z'),
      ],
      readThrough: '2026-07-02T10:00:00.000Z',
    })
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(1))
  })

  it('does not undo a mark-unread by re-reading when only the watermark moves back', async () => {
    const { hook, markConversationRead } = setup({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: '2026-07-02T10:00:00.000Z',
    })
    hook.rerender({
      messages: [message('m1', '2026-07-02T10:00:00.000Z')],
      readThrough: '2026-07-01T00:00:00.000Z',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(markConversationRead).not.toHaveBeenCalled()
  })

  it('marks read again when the host shows the thread, with no new message', async () => {
    const markConversationRead = vi.fn().mockResolvedValue({ ok: true })
    const rpc = { ...portalVisitorRpc, markConversationRead } as unknown as VisitorSurfaceRpc
    const wrapper = ({ children }: { children: ReactNode }) => (
      <VisitorSurfaceRpcProvider value={rpc}>{children}</VisitorSurfaceRpcProvider>
    )
    const messages = [message('m1', '2026-07-02T10:00:00.000Z')]
    const hook = renderHook(
      (props: { recheck: number }) =>
        useMarkReadOnIncoming({
          conversationId: CONVERSATION,
          messages,
          whenLastFrom: 'visitor',
          recheck: props.recheck,
        }),
      { wrapper, initialProps: { recheck: 0 } }
    )
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(1))
    hook.rerender({ recheck: 0 })
    await new Promise((r) => setTimeout(r, 20))
    expect(markConversationRead).toHaveBeenCalledTimes(1)
    hook.rerender({ recheck: 1 })
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(2))
  })
})
