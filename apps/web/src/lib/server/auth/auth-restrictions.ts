/**
 * Auth Restrictions - Validates authentication methods based on user role and config
 *
 * This module provides functions to check if a given authentication method is
 * allowed for a specific user role, based on the portal configuration.
 *
 * Key rules:
 * - Portal users (role: 'user') use portalConfig settings
 * - Team members (role: 'admin' | 'member') can always use email, github, google
 */

import { getPublicPortalConfig } from '@/lib/server/domains/settings/settings.service'

export type AuthProvider = 'email' | 'github' | 'google'
export type Role = 'admin' | 'member' | 'user'

interface AuthMethodResult {
  allowed: boolean
  error?: string
}

/**
 * Check if an authentication method is allowed for a given role.
 *
 * @param provider - The auth provider being used
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

  // Team members (admin/member) can always use any provider
  return { allowed: true }
}

async function checkPortalAuthMethod(provider: AuthProvider): Promise<AuthMethodResult> {
  const portalConfig = await getPublicPortalConfig()

  if (provider === 'email') {
    // Email can be disabled in portal config (defaults to true for backwards compatibility)
    const enabled = portalConfig.oauth.email ?? true
    return enabled ? { allowed: true } : { allowed: false, error: 'email_method_not_allowed' }
  }

  if (provider === 'github' || provider === 'google') {
    const enabled = provider === 'github' ? portalConfig.oauth.github : portalConfig.oauth.google
    return enabled ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
  }

  return { allowed: false, error: 'auth_method_not_allowed' }
}

/**
 * Get the allowed auth methods for a given role.
 * Useful for building login forms.
 */
export async function getAllowedAuthMethods(role: Role): Promise<{
  email: boolean
  github: boolean
  google: boolean
}> {
  const results = await Promise.all([
    isAuthMethodAllowed('email', role),
    isAuthMethodAllowed('github', role),
    isAuthMethodAllowed('google', role),
  ])

  return {
    email: results[0].allowed,
    github: results[1].allowed,
    google: results[2].allowed,
  }
}
