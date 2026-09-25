/**
 * A new message whose write also published the conversation's own event
 * leaves the inbox list's refresh to that companion event. The two are
 * published separately and never replayed, so if the companion is lost the
 * list must still refresh, once, after a short wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'
import { companionRefreshFallback } from '../events-reducer'

const CONV = 'conversation_01h455vb4pex5vsknk084sn02q' as ConversationId
const OTHER = 'conversation_01h455vb4pex5vsknk084sn02r' as ConversationId

const flagged = (id = CONV) =>
  ({
    kind: 'message',
    conversationId: id,
    message: {},
    conversationUpdated: true,
  }) as unknown as ConversationStreamEvent
const plain = (id = CONV) =>
  ({ kind: 'message', conversationId: id, message: {} }) as unknown as ConversationStreamEvent
const companion = (id = CONV) =>
  ({ kind: 'conversation', conversation: { id } }) as unknown as ConversationStreamEvent

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('companionRefreshFallback', () => {
  it('refreshes once when the companion event never arrives', () => {
    const refresh = vi.fn()
    const onEvent = companionRefreshFallback(refresh, 1000)
    onEvent(flagged())
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('leaves the refresh to a companion that arrives in time', () => {
    const refresh = vi.fn()
    const onEvent = companionRefreshFallback(refresh, 1000)
    onEvent(flagged())
    vi.advanceTimersByTime(300)
    onEvent(companion())
    vi.advanceTimersByTime(2000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('leaves the refresh to a companion that arrived first', () => {
    const refresh = vi.fn()
    const onEvent = companionRefreshFallback(refresh, 1000)
    onEvent(companion())
    vi.advanceTimersByTime(200)
    onEvent(flagged())
    vi.advanceTimersByTime(2000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('waits for the companion of its own conversation only', () => {
    const refresh = vi.fn()
    const onEvent = companionRefreshFallback(refresh, 1000)
    onEvent(flagged(CONV))
    onEvent(companion(OTHER))
    vi.advanceTimersByTime(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ignores a message whose write sent no companion', () => {
    const refresh = vi.fn()
    const onEvent = companionRefreshFallback(refresh, 1000)
    onEvent(plain())
    vi.advanceTimersByTime(2000)
    expect(refresh).not.toHaveBeenCalled()
  })
})
