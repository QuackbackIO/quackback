/**
 * Queue wrapper for `conversation-inactivity-delivery`.
 *
 * One handler module per queue, imported statically, so `primeJobHandlers()`
 * loads the delivery code outside any workspace scope. The work itself lives in
 * conversation.inactivity-delivery.ts; this file exists so the registry's
 * queue-to-module derivation stays one to one (see
 * jobs/__tests__/handler-imports.test.ts).
 */
export { deliverInactivity } from './conversation.inactivity-delivery'
