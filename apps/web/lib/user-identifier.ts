import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const USER_ID_COOKIE = 'qb_user_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Get or create a user identifier from cookies (server-side)
 * Used for anonymous voting and comment tracking
 */
export async function getUserIdentifier(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(USER_ID_COOKIE)?.value

  if (existing) {
    return existing
  }

  // Generate new identifier - will be set via response
  return crypto.randomUUID()
}

/**
 * Get user identifier from request (for API routes)
 */
export function getUserIdentifierFromRequest(request: NextRequest): string {
  const existing = request.cookies.get(USER_ID_COOKIE)?.value

  if (existing) {
    return existing
  }

  return crypto.randomUUID()
}

/**
 * Set user identifier cookie in response headers
 */
export function setUserIdentifierCookie(
  headers: Headers,
  userIdentifier: string
): void {
  headers.set(
    'Set-Cookie',
    `${USER_ID_COOKIE}=${userIdentifier}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`
  )
}

/**
 * Check if user identifier cookie exists in request
 */
export function hasUserIdentifierCookie(request: NextRequest): boolean {
  return !!request.cookies.get(USER_ID_COOKIE)?.value
}
