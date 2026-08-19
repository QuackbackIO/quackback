/**
 * Shared fixtures for suites that mock `@/lib/client/copilot-events`. The
 * real module can't be `importOriginal`'d from component tests — it pulls in
 * the server-fn module `recordCopilotEventFn` lives in — so mocks re-supply
 * `itemRefBody` from here instead of each suite re-implementing it. Typed as
 * `typeof itemRefBody` (a type-only import, erased at runtime) so it can
 * never drift from the real signature.
 */
import type { itemRefBody } from '@/lib/client/copilot-events'

/** Mirror of the real `itemRefBody`: the `{ conversationId } | { ticketId }`
 *  request-body fragment for an inbox item ref. */
export const mockItemRefBody: typeof itemRefBody = (item) =>
  item.kind === 'conversation' ? { conversationId: item.id } : { ticketId: item.id }
