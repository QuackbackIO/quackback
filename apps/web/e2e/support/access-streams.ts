/**
 * Raw inbox streams for the team-access specs. Streams are always opened for
 * a test's own teammates (newTeammate), never for the shared people: an
 * inbox stream marks its owner online, and closing their last one frees
 * their unanswered conversations.
 */
import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { callServerFn } from './server-fns'
import { openStream, type OpenStream, type StreamEvent } from './streams'
import type { TestTeammate } from './teammates'

/** Any frame that names this conversation or ticket. */
export const about =
  (id: string) =>
  (e: StreamEvent): boolean =>
    e.raw.includes(id)

/** The inbox_item_removed event for this item. */
export const removalOf =
  (id: string) =>
  (e: StreamEvent): boolean =>
    e.event === 'inbox_item_removed' && e.data.id === id

/** Open an inbox stream as a test's own teammate. */
export async function openInbox(t: Pick<TestTeammate, 'cookie'>): Promise<OpenStream> {
  const stream = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
  expect(stream.status, stream.body).toBe(200)
  return stream
}

/**
 * Cause a frame every listed stream should carry (an admin note on a
 * conversation they can all see) and wait until each has it. Use it to know
 * the streams are subscribed before acting, and as the closing marker before
 * asserting a frame never came.
 */
export async function noteAndWait(
  admin: APIRequestContext,
  conversationId: string,
  streams: OpenStream[],
  text: string
): Promise<void> {
  // A stream that was still subscribing misses the first note; send another.
  let pending = [...streams]
  for (let attempt = 1; attempt <= 5 && pending.length > 0; attempt++) {
    const content = `${text} #${attempt}`
    const res = await callServerFn(admin, 'addConversationNoteFn', { conversationId, content })
    expect(res.ok, res.error).toBe(true)
    const waits = await Promise.allSettled(
      pending.map((s) => s.waitFor((e) => e.raw.includes(content), attempt === 5 ? 15_000 : 3_000))
    )
    pending = pending.filter((_, i) => waits[i].status === 'rejected')
  }
  expect(pending.length, `streams that never saw "${text}"`).toBe(0)
}
