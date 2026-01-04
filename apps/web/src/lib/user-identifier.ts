const USER_ID_COOKIE = 'qb_user_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * User identifier format:
 * - Authenticated users: `member:{memberId}` (Hub-and-Spoke identity model)
 * - Anonymous users: `anon:{uuid}` (cookie-based)
 */

/**
 * Parse cookie from request headers
 */
function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const cookie = cookies.find((c) => c.startsWith(`${name}=`))
  return cookie ? cookie.substring(name.length + 1) : null
}

/**
 * Get or create a user identifier from cookies (server-side with request context)
 * Used for anonymous voting and comment tracking
 *
 * Note: This now requires a Request object to access cookies.
 * Use getUserIdentifierFromRequest() for all use cases.
 *
 * For authenticated users with org membership, use getMemberIdentifier() instead
 * @deprecated Use getUserIdentifierFromRequest() instead
 */
export async function getUserIdentifier(): Promise<string> {
  // Generate new identifier - will be set via response
  // Note: In TanStack Start, we need request context to read cookies
  return `anon:${crypto.randomUUID()}`
}

/**
 * Get user identifier from request (for API routes)
 * Returns anonymous identifier format: `anon:{uuid}`
 *
 * For authenticated users with org membership, use getMemberIdentifierFromRequest() instead
 */
export function getUserIdentifierFromRequest(request: Request): string {
  const cookieHeader = request.headers.get('cookie')
  const existing = parseCookie(cookieHeader, USER_ID_COOKIE)

  if (existing) {
    return `anon:${existing}`
  }

  return `anon:${crypto.randomUUID()}`
}

/**
 * Get the raw UUID from the cookie (for setting cookies)
 */
export function getRawUserIdentifierFromRequest(request: Request): string {
  const cookieHeader = request.headers.get('cookie')
  const existing = parseCookie(cookieHeader, USER_ID_COOKIE)
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
 * Cookie is per-subdomain (no cross-subdomain sharing)
 * Note: Pass the raw UUID, not the prefixed identifier
 */
export function setUserIdentifierCookie(headers: Headers, rawUuid: string): void {
  headers.set(
    'Set-Cookie',
    `${USER_ID_COOKIE}=${rawUuid}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`
  )
}

/**
 * Check if user identifier cookie exists in request
 */
export function hasUserIdentifierCookie(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie')
  return !!parseCookie(cookieHeader, USER_ID_COOKIE)
}
