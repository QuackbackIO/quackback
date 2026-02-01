/**
 * Auth Restrictions - Validates authentication methods based on user role and config
 *
 * This module provides functions to check if a given authentication method is
 * allowed for a specific user role, based on the security and portal configurations.
 *
 * Key rules:
 * - Portal users (role: 'user') use portalConfig settings
 * - Team members (role: 'admin' | 'member') use securityConfig settings
 * - Email is always allowed for team members (admin bypass safety measure)
 * - When SSO is required, social logins are disabled for team members
 */

import {
  getFullSecurityConfig,
  getPublicPortalConfig,
} from '@/lib/server/domains/settings/settings.service'

export type AuthProvider = 'email' | 'github' | 'google' | 'oidc' | 'team-sso'
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

  // Team members (admin/member) use security config
  return checkTeamAuthMethod(provider)
}

async function checkPortalAuthMethod(provider: AuthProvider): Promise<AuthMethodResult> {
  if (provider === 'team-sso') {
    return { allowed: false, error: 'auth_method_not_allowed' }
  }

  const portalConfig = await getPublicPortalConfig()

  if (provider === 'email') {
    // Email can now be disabled in portal config (defaults to true for backwards compatibility)
    const enabled = portalConfig.oauth.email ?? true
    return enabled ? { allowed: true } : { allowed: false, error: 'email_method_not_allowed' }
  }

  if (provider === 'github' || provider === 'google') {
    const enabled = provider === 'github' ? portalConfig.oauth.github : portalConfig.oauth.google
    return enabled ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
  }

  if (provider === 'oidc') {
    return portalConfig.oidc?.enabled
      ? { allowed: true }
      : { allowed: false, error: 'oidc_not_configured' }
  }

  return { allowed: false, error: 'auth_method_not_allowed' }
}

async function checkTeamAuthMethod(provider: AuthProvider): Promise<AuthMethodResult> {
  if (provider === 'email') {
    return { allowed: true }
  }

  if (provider === 'oidc') {
    return { allowed: false, error: 'auth_method_not_allowed' }
  }

  const securityConfig = await getFullSecurityConfig()
  if (!securityConfig) {
    return { allowed: true }
  }

  if (provider === 'team-sso') {
    return securityConfig.sso.enabled
      ? { allowed: true }
      : { allowed: false, error: 'sso_not_configured' }
  }

  // GitHub and Google checks
  const ssoRequired = securityConfig.sso.enabled && securityConfig.sso.enforcement === 'required'
  if (ssoRequired) {
    return { allowed: false, error: 'sso_required' }
  }

  const enabled =
    provider === 'github'
      ? securityConfig.teamSocialLogin.github
      : securityConfig.teamSocialLogin.google

  return enabled ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

/**
 * Get the allowed auth methods for a given role.
 * Useful for building login forms.
 */
export async function getAllowedAuthMethods(role: Role): Promise<{
  email: boolean
  github: boolean
  google: boolean
  oidc: boolean
  teamSso: boolean
}> {
  const results = await Promise.all([
    isAuthMethodAllowed('email', role),
    isAuthMethodAllowed('github', role),
    isAuthMethodAllowed('google', role),
    isAuthMethodAllowed('oidc', role),
    isAuthMethodAllowed('team-sso', role),
  ])

  return {
    email: results[0].allowed,
    github: results[1].allowed,
    google: results[2].allowed,
    oidc: results[3].allowed,
    teamSso: results[4].allowed,
  }
}
