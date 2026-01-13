export type CFSSLStatus =
  | 'initializing'
  | 'pending_validation'
  | 'pending_issuance'
  | 'pending_deployment'
  | 'active'
  | 'pending_expiration'
  | 'expired'
  | 'pending_deletion'
  | 'deleted'

export type CFOwnershipStatus = 'pending' | 'active' | 'moved' | 'blocked' | 'deleted'

export interface CFValidationRecord {
  status: string
  txt_name?: string
  txt_value?: string
  http_url?: string
  http_body?: string
}

export interface CFSSLConfig {
  id?: string
  status: CFSSLStatus
  method: 'http' | 'txt' | 'email'
  type: 'dv'
  validation_records?: CFValidationRecord[]
  validation_errors?: Array<{ message: string }>
  certificate_authority?: string
}

export interface CFOwnershipVerification {
  type: 'txt'
  name: string
  value: string
}

export interface CFOwnershipVerificationHTTP {
  http_url: string
  http_body: string
}

export interface CFCustomHostname {
  id: string
  hostname: string
  status: CFOwnershipStatus
  ssl: CFSSLConfig
  ownership_verification?: CFOwnershipVerification
  ownership_verification_http?: CFOwnershipVerificationHTTP
  custom_metadata?: Record<string, string>
  created_at: string
}

export interface CFCreateHostnameResponse {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result?: CFCustomHostname
}

export interface CFGetHostnameResponse {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result?: CFCustomHostname
}

export interface CFDeleteHostnameResponse {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result?: { id: string }
}

export interface CFWebhookEvent {
  type: string
  data: {
    custom_hostname_id: string
    hostname: string
    certificate_id?: string
    status?: string
    ssl?: {
      method: string
      type: string
      issuer?: string
    }
  }
}
