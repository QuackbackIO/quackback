/**
 * Auth Restrictions - Validates authentication methods based on user role and config
 *
 * This module provides functions to check if a given authentication method is
 * allowed for a specific user role, based on the portal configuration and
 * whether credentials are configured in the database.
 *
 * Key rules:
 * - Portal users (role: 'user') use portalConfig settings (filtered by credential availability)
 * - Team members (role: 'admin' | 'member') can use any provider with configured credentials
 */

import { getPublicPortalConfig } from '@/lib/server/domains/settings/settings.service'

export type AuthProvider = 'email' | string
export type Role = 'admin' | 'member' | 'user'

interface AuthMethodResult {
  allowed: boolean
  error?: string
}

/**
 * Check if an authentication method is allowed for a given role.
 *
 * @param provider - The auth provider being used ('email', 'github', 'google', etc.)
 * @param role - The user's role (or expected role for new users)
 * @returns Whether the auth method is allowed, with optional error code
 */
export async function isAuthMethodAllowed(
  provider: AuthProvider,
  role: Role
): Promise<AuthMethodResult> {
  // Portal users (role: 'user') use portal config
  if (role === 'user') {
    return checkPortalAuthMethod(provider)
  }

  // Team members: email is always allowed, OAuth needs credentials
  if (provider === 'email') {
    return { allowed: true }
  }

  // Check if credentials exist for this OAuth provider
  const { hasPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const hasCredentials = await hasPlatformCredentials(`auth_${provider}`)
  return hasCredentials ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

async function checkPortalAuthMethod(provider: AuthProvider): Promise<AuthMethodResult> {
  // getPublicPortalConfig already filters by credential availability
  const portalConfig = await getPublicPortalConfig()

  if (provider === 'email') {
    const enabled = portalConfig.oauth.email ?? true
    return enabled ? { allowed: true } : { allowed: false, error: 'email_method_not_allowed' }
  }

  // Any OAuth provider — check if enabled (already filtered by credential availability)
  const enabled = portalConfig.oauth[provider]
  return enabled ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

/**
 * Get the allowed auth methods for a given role.
 * Returns a dynamic map of provider ID → boolean.
 */
export async function getAllowedAuthMethods(role: Role): Promise<Record<string, boolean>> {
  if (role === 'user') {
    const portalConfig = await getPublicPortalConfig()
    const methods: Record<string, boolean> = {
      email: portalConfig.oauth.email ?? true,
    }
    for (const [key, enabled] of Object.entries(portalConfig.oauth)) {
      if (key !== 'email') {
        methods[key] = !!enabled
      }
    }
    return methods
  }

  // Team members: check what credentials are configured
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const configuredTypes = await getConfiguredIntegrationTypes()

  const methods: Record<string, boolean> = { email: true }
  for (const type of configuredTypes) {
    if (type.startsWith('auth_')) {
      methods[type.replace('auth_', '')] = true
    }
  }
  return methods
}
