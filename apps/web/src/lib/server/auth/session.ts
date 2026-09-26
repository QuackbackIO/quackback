import type { UserId, SessionId } from '@quackback/ids'
import { getRequestPrincipal, getRequestSession } from '@/lib/server/auth/request-session'
import { logger } from '@/lib/server/logger'
import type { PrincipalType, SessionScope } from '@/lib/shared/roles'
import { toSessionScope } from '@/lib/shared/roles'

const log = logger.child({ component: 'auth-session' })

export type { PrincipalType }

export interface SessionUser {
  id: UserId
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  principalType: PrincipalType
  createdAt: string
  updatedAt: string
}

export interface Session {
  // No `token` field: the Session shape flows into client-bound bootstrap
  // payloads that are dehydrated into SSR HTML, and embedding the raw token
  // there would defeat the HttpOnly cookie. Paths that need it (widget
  // iframe handoff) read the cookie directly.
  session: {
    id: SessionId
    expiresAt: string
    createdAt: string
    updatedAt: string
    userId: UserId
    scope: SessionScope
  }
  user: SessionUser
}

/** The request's session with its principal type; both reads are shared with the rest of the request. */
export async function getSession(): Promise<Session | null> {
  log.debug('get session')
  try {
    const session = await getRequestSession()

    if (!session?.user) {
      return null
    }

    const userId = session.user.id as UserId

    const principalRecord = await getRequestPrincipal(userId)

    return {
      session: {
        id: session.session.id as SessionId,
        expiresAt: session.session.expiresAt.toISOString(),
        createdAt: session.session.createdAt.toISOString(),
        updatedAt: session.session.updatedAt.toISOString(),
        userId,
        scope: toSessionScope(session.session.scope),
      },
      user: {
        id: userId,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? null,
        principalType: (principalRecord?.type as PrincipalType) ?? 'user',
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    }
  } catch (error) {
    log.error({ err: error }, 'get session failed')
    throw error
  }
}
