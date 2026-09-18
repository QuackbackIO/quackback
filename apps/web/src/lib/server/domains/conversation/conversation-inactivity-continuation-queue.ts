/**
 * Queue wrapper for `conversation-inactivity-continuation`.
 *
 * Same shape as conversation-inactivity-delivery-queue.ts: a static re-export
 * so the queue owns one primed module and the registry derivation stays one to
 * one. The continuation logic lives in conversation.inactivity.ts.
 */
export { continueInactivity } from './conversation.inactivity'
