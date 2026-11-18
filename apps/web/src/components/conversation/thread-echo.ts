import type { ConversationId } from '@quackback/ids'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'

type ThreadFrame = Extract<ConversationStreamEvent, { kind: 'conversation' | 'message' }>

/**
 * This tab's own send reaches the open thread twice: as the send's response,
 * and as the stream's echo of it (a `conversation` frame and a `message`
 * frame). The response's write and the send's own state changes (the
 * mutation settling, the composer resetting) land in one render. An echo that
 * lands first writes the thread in a render of its own, so the whole thread
 * renders once more, and only in that order.
 *
 * While a send to a conversation is in flight, its `conversation` and
 * `message` frames are held here and applied, together, once the send
 * settles: after the response wrote the same message and conversation, so
 * they change nothing (the message is deduplicated, and a conversation equal
 * to the cached one keeps its reference). Both orders then cost the
 * response's one render. A send that never settles releases its frames after
 * `timeoutMs`.
 */
export function createOwnSendEchoHold(opts: {
  /** Whether this tab has a send to the conversation in flight. */
  isSending: (conversationId: ConversationId) => boolean
  /** Call `done` once that send settles; returns an unsubscribe. */
  onSendSettled: (conversationId: ConversationId, done: () => void) => () => void
  /** Apply held frames, in order, in one write. */
  flush: (conversationId: ConversationId, frames: ThreadFrame[]) => void
  timeoutMs: number
}) {
  const held = new Map<
    ConversationId,
    { frames: ThreadFrame[]; release: () => void; timer: ReturnType<typeof setTimeout> }
  >()

  const releaseNow = (conversationId: ConversationId) => {
    const entry = held.get(conversationId)
    if (!entry) return
    held.delete(conversationId)
    clearTimeout(entry.timer)
    entry.release()
    opts.flush(conversationId, entry.frames)
  }

  return {
    /**
     * Hold `evt` while this tab's send to the conversation is in flight.
     * Returns true when held (the caller writes nothing now). Frames other
     * than `conversation` and `message` are never held.
     */
    hold(conversationId: ConversationId, evt: ConversationStreamEvent): boolean {
      if (evt.kind !== 'conversation' && evt.kind !== 'message') return false
      const entry = held.get(conversationId)
      if (entry) {
        entry.frames.push(evt)
        return true
      }
      if (!opts.isSending(conversationId)) return false
      const release = opts.onSendSettled(conversationId, () => releaseNow(conversationId))
      const timer = setTimeout(() => releaseNow(conversationId), opts.timeoutMs)
      held.set(conversationId, { frames: [evt], release, timer })
      return true
    },
    /** Drop every held frame without applying it (the owner is going away). */
    cancel(): void {
      for (const { release, timer } of held.values()) {
        clearTimeout(timer)
        release()
      }
      held.clear()
    },
  }
}
