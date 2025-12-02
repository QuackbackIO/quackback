import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const USER_ID_COOKIE = 'qb_user_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * User identifier format:
 * - Authenticated users: `member:{memberId}` (Hub-and-Spoke identity model)
 * - Anonymous users: `anon:{uuid}` (cookie-based)
 */

/**
 * Get or create a user identifier from cookies (server-side)
 * Used for anonymous voting and comment tracking
 *
 * For authenticated users with org membership, use getMemberIdentifier() instead
 */
export async function getUserIdentifier(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(USER_ID_COOKIE)?.value

  if (existing) {
    // Return existing as anon identifier
    return `anon:${existing}`
  }

  // Generate new identifier - will be set via response
  return `anon:${crypto.randomUUID()}`
}

/**
 * Get user identifier from request (for API routes)
 * Returns anonymous identifier format: `anon:{uuid}`
 *
 * For authenticated users with org membership, use getMemberIdentifierFromRequest() instead
 */
export function getUserIdentifierFromRequest(request: NextRequest): string {
  const existing = request.cookies.get(USER_ID_COOKIE)?.value

  if (existing) {
    return `anon:${existing}`
  }

  return `anon:${crypto.randomUUID()}`
}

/**
 * Get the raw UUID from the cookie (for setting cookies)
 */
export function getRawUserIdentifierFromRequest(request: NextRequest): string {
  const existing = request.cookies.get(USER_ID_COOKIE)?.value
  return existing || crypto.randomUUID()
}

/**
 * Create a member-scoped identifier for authenticated users
 * Format: `member:{memberId}`
 */
export function getMemberIdentifier(memberId: string): string {
  return `member:${memberId}`
}

/**
 * Check if an identifier is a member-scoped identifier
 */
export function isMemberIdentifier(identifier: string): boolean {
  return identifier.startsWith('member:')
}

/**
 * Extract the member ID from a member-scoped identifier
 */
export function extractMemberId(identifier: string): string | null {
  if (!identifier.startsWith('member:')) {
    return null
  }
  return identifier.slice(7) // Remove 'member:' prefix
}

/**
 * Set user identifier cookie in response headers
 * Note: Pass the raw UUID, not the prefixed identifier
 */
export function setUserIdentifierCookie(headers: Headers, rawUuid: string): void {
  // Use COOKIE_DOMAIN env var for cross-subdomain support
  const domain = process.env.COOKIE_DOMAIN || ''
  const domainAttr = domain ? `; Domain=${domain}` : ''

  headers.set(
    'Set-Cookie',
    `${USER_ID_COOKIE}=${rawUuid}; Path=/${domainAttr}; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`
  )
}

/**
 * Check if user identifier cookie exists in request
 */
export function hasUserIdentifierCookie(request: NextRequest): boolean {
  return !!request.cookies.get(USER_ID_COOKIE)?.value
}
