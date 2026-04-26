import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getThemeCookie, type Theme } from '@/lib/shared/theme'
import type { Session, PrincipalType } from '@/lib/server/auth/session'
import type { TenantSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'

export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
  themeCookie: Theme
}

// Returns both the session (with principalType) AND the user role in
// one principal-table query — avoids the duplicate read the caller
// previously did to compute role separately. Saves one round-trip per
// page render for authenticated users.
async function getSessionAndRole(): Promise<{
  session: Session | null
  role: 'admin' | 'member' | 'user' | null
}> {
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
      return { session: null, role: null }
    }

    const userId = session.user.id as UserId

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
      columns: { type: true, role: true },
    })

    return {
      session: {
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
      },
      role: (principalRecord?.role as 'admin' | 'member' | 'user' | null) ?? null,
    }
  } catch (error) {
    // During SSR, auth might fail due to env var issues
    // Return null session and let the client retry
    console.error('[bootstrap] getSession error:', error)
    return { session: null, role: null }
  }
}

let _initialized = false

const getBootstrapDataInternal = createServerOnlyFn(async (): Promise<BootstrapData> => {
  const [{ getTenantSettings }, { config }, { getRequestHeaders }] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
  ])

  // Single principal read returns both session.principalType + userRole;
  // run in parallel with the settings fetch.
  const [{ session, role: userRole }, settings] = await Promise.all([
    getSessionAndRole(),
    getTenantSettings(),
  ])

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

  const headers = getRequestHeaders()
  const themeCookie = getThemeCookie(headers.get('cookie') ?? null)

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
