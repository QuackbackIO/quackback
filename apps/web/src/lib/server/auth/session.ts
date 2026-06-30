import { getRequestHeaders } from '@tanstack/react-start/server'
import type { UserId, SessionId } from '@quackback/ids'
import { auth } from '@/lib/server/auth/index'
import { db, principal as principalTable, eq } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import type { PrincipalType } from '@/lib/shared/roles'

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

export async function getSession(): Promise<Session | null> {
  log.debug('get session')
  try {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return null
    }

    const userId = session.user.id as UserId

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principalTable.userId, userId),
      columns: { type: true },
    })

    return {
      session: {
        id: session.session.id as SessionId,
        expiresAt: session.session.expiresAt.toISOString(),
        token: session.session.token,
        createdAt: session.session.createdAt.toISOString(),
        updatedAt: session.session.updatedAt.toISOString(),
        userId,
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
