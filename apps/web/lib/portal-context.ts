/**
 * Portal Context Utilities
 *
 * Handles detection of authentication context (team vs portal) for login/signup flows.
 * Team context = admin dashboard access
 * Portal context = public feedback portal access
 */

export type AuthContext = 'team' | 'portal'

/**
 * Detects the authentication context from URL parameters and pathname.
 *
 * Priority:
 * 1. Explicit `?context=portal` or `?context=team` query parameter
 * 2. Infer from `callbackUrl` - admin paths = team, portal paths = portal
 * 3. Default to team context
 */
export function getAuthContext(searchParams: URLSearchParams, _pathname: string): AuthContext {
  // Check explicit context param first
  const explicitContext = searchParams.get('context')
  if (explicitContext === 'portal' || explicitContext === 'team') {
    return explicitContext
  }

  // Infer from callback URL if present
  const callbackUrl = searchParams.get('callbackUrl') || ''
  if (callbackUrl.includes('/admin')) {
    return 'team'
  }
  if (
    callbackUrl === '/' ||
    callbackUrl.includes('/boards') ||
    callbackUrl.includes('/roadmap') ||
    callbackUrl.startsWith('/posts/')
  ) {
    return 'portal'
  }

  // Default to team context
  return 'team'
}

/**
 * Gets the default callback URL for a given auth context.
 */
export function getContextCallbackUrl(context: AuthContext): string {
  return context === 'portal' ? '/' : '/admin'
}

/**
 * Builds a login URL with the appropriate context.
 */
export function getLoginUrl(context: AuthContext, callbackUrl?: string): string {
  const params = new URLSearchParams()
  params.set('context', context)
  if (callbackUrl) {
    params.set('callbackUrl', callbackUrl)
  }
  return `/login?${params.toString()}`
}

/**
 * Builds a signup URL with the appropriate context.
 */
export function getSignupUrl(context: AuthContext, callbackUrl?: string): string {
  const params = new URLSearchParams()
  params.set('context', context)
  if (callbackUrl) {
    params.set('callbackUrl', callbackUrl)
  }
  return `/signup?${params.toString()}`
}
