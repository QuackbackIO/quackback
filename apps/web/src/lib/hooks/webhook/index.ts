/**
 * Webhook hook exports.
 *
 * IMPORTANT: This barrel export only includes client-safe code.
 * The handler (which uses Node.js crypto/dns) is NOT exported here.
 * Import handler directly in server-only code: './webhook/handler'
 */

// Client-safe exports only
export {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_CONFIG,
  isValidWebhookUrl,
  type WebhookEventType,
  type WebhookTarget,
  type WebhookConfig,
} from './constants'
