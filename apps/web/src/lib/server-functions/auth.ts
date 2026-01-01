/**
 * Auth server functions.
 *
 * Provides session retrieval with proper TypeID typing.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { UserId, SessionId } from '@quackback/ids'

/**
 * Session user type with TypeID types
 */
export interface SessionUser {
  id: UserId
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
}

export interface Session {
  session: {
    id: SessionId
    expiresAt: string
    token: string
    createdAt: string
    updatedAt: string
    userId: UserId
  }
  user: SessionUser
}

/**
 * Get the current session with user.
 * Returns null if not authenticated.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Session | null> => {
    const { auth } = await import('@/lib/auth/index')
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return null
    }

    // Serialize dates for client transport
    return {
      session: {
        id: session.session.id as SessionId,
        expiresAt: session.session.expiresAt.toISOString(),
        token: session.session.token,
        createdAt: session.session.createdAt.toISOString(),
        updatedAt: session.session.updatedAt.toISOString(),
        userId: session.session.userId as UserId,
      },
      user: {
        id: session.user.id as UserId,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? null,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    }
  }
)
