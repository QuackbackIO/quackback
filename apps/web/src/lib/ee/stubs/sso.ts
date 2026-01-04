/**
 * Stub for @quackback/ee-sso
 *
 * This module is used when INCLUDE_EE=false to enable tree-shaking.
 * It provides the same exports as the real package but with no-op implementations.
 */

export interface SAMLConfig {
  entityId: string
  ssoUrl: string
  certificate: string
}

export interface SSOProvider {
  id: string
  name: string
  type: 'saml' | 'oidc'
}

export interface SSOConnection {
  id: string
  providerId: string
  enabled: boolean
}

export function configureSAML(_config: SAMLConfig): void {
  throw new Error('SSO is not available in this edition. Upgrade to Enterprise.')
}

export const SSO_AVAILABLE = false
