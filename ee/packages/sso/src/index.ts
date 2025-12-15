/**
 * @quackback/ee/sso - Enterprise SSO/SAML Authentication
 *
 * This package provides SSO/SAML authentication for Quackback Enterprise.
 * Available on Team tier and above.
 */

import type { OrgId } from '@quackback/ids'

// TODO: Implement SAML authentication
// - SAML 2.0 service provider
// - IdP metadata parsing
// - Assertion validation
// - Just-in-time user provisioning

// TODO: Implement OIDC support
// - Generic OIDC provider support
// - Custom claim mapping
// - Token refresh handling

export interface SSOConfig {
  enabled: boolean
  provider: 'saml' | 'oidc'
  idpMetadataUrl?: string
  entityId?: string
  assertionConsumerServiceUrl?: string
  singleLogoutServiceUrl?: string
}

export interface SSOSession {
  userId: string
  organizationId: OrgId
  provider: string
  idpSessionId?: string
  expiresAt: Date
}

/**
 * Placeholder SSO Service - To be implemented
 */
export class SSOService {
  async initiateSSOLogin(_organizationId: OrgId): Promise<{ redirectUrl: string }> {
    throw new Error('SSO not yet implemented')
  }

  async handleCallback(
    _organizationId: OrgId,
    _samlResponse: string
  ): Promise<{ session: SSOSession }> {
    throw new Error('SSO not yet implemented')
  }

  async logout(_sessionId: string): Promise<void> {
    throw new Error('SSO not yet implemented')
  }
}
