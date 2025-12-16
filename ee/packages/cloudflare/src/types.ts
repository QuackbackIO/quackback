// ============================================================================
// Cloudflare for SaaS Types
// ============================================================================

/**
 * SSL certificate status progression:
 * initializing → pending_validation → pending_issuance → pending_deployment → active
 */
export type CFSSLStatus =
  | 'initializing'
  | 'pending_validation'
  | 'pending_issuance'
  | 'pending_deployment'
  | 'active'
  | 'pending_expiration'
  | 'expired'
  | 'deleted'

/**
 * Custom hostname ownership verification status
 */
export type CFOwnershipStatus = 'pending' | 'active' | 'moved' | 'blocked' | 'deleted'

/**
 * SSL validation record (DCV token)
 */
export interface CFValidationRecord {
  status: string
  txt_name?: string
  txt_value?: string
  http_url?: string
  http_body?: string
}

/**
 * SSL configuration in custom hostname response
 */
export interface CFSSLConfig {
  id: string
  status: CFSSLStatus
  method: 'http' | 'txt' | 'cname'
  type: 'dv'
  validation_records?: CFValidationRecord[]
  certificate_authority?: string
}

/**
 * Custom hostname record from Cloudflare API
 */
export interface CFCustomHostname {
  id: string
  hostname: string
  ssl: CFSSLConfig
  ownership_verification?: {
    type: 'txt'
    name: string
    value: string
  }
  ownership_verification_http?: {
    http_url: string
    http_body: string
  }
  status: CFOwnershipStatus
  created_at: string
  custom_metadata?: Record<string, string>
}

/**
 * Cloudflare API response wrapper
 */
export interface CFApiResponse<T> {
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: string[]
  result: T
}

/**
 * Parameters for creating a custom hostname
 */
export interface CreateHostnameParams {
  hostname: string
  organizationId: string
}

/**
 * Cloudflare webhook event types we handle
 */
export type CFWebhookEventType =
  | 'ssl.certificate_validation_status_change'
  | 'custom_hostname.update'

/**
 * Cloudflare webhook payload structure
 */
export interface CFWebhookPayload {
  event: CFWebhookEventType
  data: CFCustomHostname
}
