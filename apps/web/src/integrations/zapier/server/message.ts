/** zapier reuses the generic webhook payload builder (IF WO-11: no cross-provider imports). */
export { buildWebhookPayload as buildZapierPayload } from '@/lib/server/integrations/webhook-payload'
