import { randomUUID } from 'node:crypto'

/**
 * `chat()` needs a `threadId` since @tanstack/ai 1.0 and throws without one.
 * Server-side calls have no client thread to join: each one-shot request, and
 * each dial of a streamed turn (whose AG-UI lifecycle the route owns), gets a
 * fresh id, which is what the 0.x engine minted on its own.
 */
export function oneShotThreadId(): string {
  return randomUUID()
}
