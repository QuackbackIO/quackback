/** make reuses the generic webhook payload builder (IF WO-11: no cross-provider imports). */
export { buildWebhookPayload as buildMakePayload } from '@/lib/server/integrations/webhook-payload'
