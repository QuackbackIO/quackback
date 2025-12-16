// ============================================================================
// Cloudflare for SaaS - EE Package
// ============================================================================

// Client
export { getCloudflare, isCloudflareConfigured } from './client'

// Hostname operations
export {
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  refreshCustomHostname,
} from './hostnames'

// Webhooks
export { verifyWebhookSignature, processWebhookEvent } from './webhooks'

// Types
export type {
  CFCustomHostname,
  CFSSLStatus,
  CFOwnershipStatus,
  CFSSLConfig,
  CFValidationRecord,
  CFApiResponse,
  CreateHostnameParams,
  CFWebhookEventType,
  CFWebhookPayload,
} from './types'
