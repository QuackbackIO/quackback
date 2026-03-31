import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getThemeCookie, type Theme } from '@/lib/shared/theme'
import type { Session, PrincipalType } from './auth'
import type { TenantSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'

export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
  themeCookie: Theme
}

async function getSessionInternal(): Promise<Session | null> {
  const [{ getRequestHeaders }, { auth }, { db, principal, eq }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('@/lib/server/auth/index'),
    import('@/lib/server/db'),
  ])

  try {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return null
    }

    const userId = session.user.id as UserId

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
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
    // During SSR, auth might fail due to env var issues
    // Return null session and let the client retry
    console.error('[bootstrap] getSession error:', error)
    return null
  }
}

let _initialized = false

const getBootstrapDataInternal = createServerOnlyFn(async (): Promise<BootstrapData> => {
  const [{ getTenantSettings }, { db, principal, eq }, { config }, { getRequestHeaders }] =
    await Promise.all([
      import('@/lib/server/domains/settings/settings.service'),
      import('@/lib/server/db'),
      import('@/lib/server/config'),
      import('@tanstack/react-start/server'),
    ])

  // Fetch session and settings in parallel
  const [session, settings] = await Promise.all([getSessionInternal(), getTenantSettings()])

  // Get user role
  const userRole = session
    ? await db.query.principal
        .findFirst({
          where: eq(principal.userId, session.user.id as UserId),
          columns: { role: true },
        })
        .then((m) => (m?.role as 'admin' | 'member' | 'user' | null) ?? null)
    : null

  // One-time initialization on first request
  if (!_initialized) {
    _initialized = true

    // Delay telemetry to let the DB connection initialize
    setTimeout(async () => {
      try {
        const { startTelemetry } = await import('@/lib/server/telemetry')
        await startTelemetry()
      } catch {
        // Silent failure -- telemetry must never affect the application
      }
    }, 10_000)
  }

  const themeCookie = getThemeCookie(getRequestHeaders().get('cookie') ?? null)

  return { baseUrl: config.baseUrl, session, settings, userRole, themeCookie }
})

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    console.log(`[fn:bootstrap] getBootstrapData`)
    try {
      return await getBootstrapDataInternal()
    } catch (error) {
      console.error(`[fn:bootstrap] getBootstrapData failed:`, error)
      throw error
    }
  }
)
