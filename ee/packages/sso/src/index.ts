/**
 * @quackback/ee-sso
 *
 * Enterprise SSO/SAML authentication for Quackback.
 * Wraps @better-auth/sso for enterprise identity providers.
 *
 * Supported providers:
 * - Okta
 * - Azure AD (Entra ID)
 * - Google Workspace
 * - OneLogin
 * - Generic SAML 2.0
 *
 * @license Proprietary - See ee/LICENSE
 */

export { configureSAML, type SAMLConfig } from './saml'
export { type SSOProvider, type SSOConnection } from './types'

/**
 * Check if SSO module is available
 * Used by the main app to detect EE SSO capability
 */
export const SSO_AVAILABLE = true
