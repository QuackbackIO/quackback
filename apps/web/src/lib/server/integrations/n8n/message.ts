/**
 * n8n webhook payload formatting.
 * Reuses the same structured payload format as Zapier.
 */

export { buildZapierPayload as buildN8nPayload } from '../zapier/message'
