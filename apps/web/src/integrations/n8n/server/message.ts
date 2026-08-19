/** n8n reuses the generic webhook payload builder (IF WO-11: no cross-provider imports). */
export { buildWebhookPayload as buildN8nPayload } from '@/lib/server/integrations/webhook-payload'
