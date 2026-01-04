/**
 * SSO Types
 */

export type SSOProviderType = 'okta' | 'azure-ad' | 'google-workspace' | 'onelogin' | 'saml'

export interface SSOProvider {
  id: string
  type: SSOProviderType
  name: string
  enabled: boolean
  config: SAMLProviderConfig | OIDCProviderConfig
}

export interface SAMLProviderConfig {
  entityId: string
  ssoUrl: string
  certificate: string
  signatureAlgorithm?: 'sha256' | 'sha512'
  digestAlgorithm?: 'sha256' | 'sha512'
}

export interface OIDCProviderConfig {
  clientId: string
  clientSecret: string
  issuer: string
  scopes?: string[]
}

export interface SSOConnection {
  id: string
  providerId: string
  userId: string
  externalId: string
  email: string
  createdAt: Date
  lastLoginAt: Date | null
}
