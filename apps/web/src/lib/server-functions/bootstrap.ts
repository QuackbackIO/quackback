import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { tenantStorage, type RequestContext } from '@/lib/tenant'
import { getTenantSettings } from '@/lib/settings/settings.service'
import { auth } from '@/lib/auth/index'
import { db, member, eq } from '@/lib/db'
import type { Session } from './auth'
import type { TenantSettings } from '@/lib/settings'
import type { SessionId, UserId } from '@quackback/ids'

export interface BootstrapData {
  requestContext: RequestContext
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
}

function buildRequestContext(): RequestContext {
  const store = tenantStorage.getStore()

  if (!store) {
    return { type: 'unknown' }
  }

  switch (store.contextType) {
    case 'app-domain':
      return { type: 'app-domain' }
    case 'self-hosted':
      return { type: 'self-hosted', settings: store.settings }
    case 'tenant':
      return {
        type: 'tenant',
        workspaceId: store.workspaceId ?? '',
        settings: store.settings,
      }
    case 'unknown':
      return { type: 'unknown' }
  }
}

async function getSessionInternal(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  })

  if (!session?.user) {
    return null
  }

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

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    const requestContext = buildRequestContext()

    if (requestContext.type === 'app-domain' || requestContext.type === 'unknown') {
      return { requestContext, session: null, settings: null, userRole: null }
    }

    // Fetch session and settings in parallel
    const [session, settings] = await Promise.all([getSessionInternal(), getTenantSettings()])

    // Get user role in parallel with nothing blocking it
    // (moved outside the session check to avoid sequential query)
    const userRole = session
      ? await db.query.member
          .findFirst({
            where: eq(member.userId, session.user.id as UserId),
            columns: { role: true },
          })
          .then((m) => (m?.role as 'admin' | 'member' | 'user') ?? null)
      : null

    return { requestContext, session, settings, userRole }
  }
)
