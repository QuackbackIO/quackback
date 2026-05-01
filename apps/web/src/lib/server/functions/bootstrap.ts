import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getThemeCookie, type Theme } from '@/lib/shared/theme'
import type { Session, PrincipalType } from '@/lib/server/auth/session'
import type { TenantSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'
import { IS_CLOUD } from '@/lib/server/edition'

export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
  themeCookie: Theme
  /**
   * True when EDITION=cloud. UI shells use this to gate upgrade chrome,
   * tier-related settings UI, and 402 modals. Self-hosted defaults to false.
   */
  isCloud: boolean
}

// Returns both the session (with principalType) AND the user role in
// one principal-table query — avoids the duplicate read the caller
// previously did to compute role separately. Saves one round-trip per
// page render for authenticated users.
async function getSessionAndRole(): Promise<{
  session: Session | null
  role: 'admin' | 'member' | 'user' | null
}> {
  // Fast-path for unauthenticated requests: if there's no Cookie header at
  // all the request can't possibly carry a session token, so we can skip
  // every dynamic import below + auth.api.getSession's DB lookup. Hot path
  // for every cold-start landing-page hit since the visitor has no cookies.
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const headers = getRequestHeaders()
  if (!headers.get('cookie')) {
    return { session: null, role: null }
  }

  const [{ auth }, { db, principal, eq }, { cacheGet, cacheSet, CACHE_KEYS }] = await Promise.all([
    import('@/lib/server/auth/index'),
    import('@/lib/server/db'),
    import('@/lib/server/redis'),
  ])

  try {
    const session = await auth.api.getSession({
      headers,
    })

    if (!session?.user) {
      return { session: null, role: null }
    }

    const userId = session.user.id as UserId

    // Cache the principal type/role per user. Hot path on every
    // authenticated SSR render. Mutation paths (principal.service.ts,
    // api-key.service.ts, auth/index.ts anon-link) invalidate explicitly;
    // the 5min TTL backstops anything we miss.
    const cacheKey = CACHE_KEYS.PRINCIPAL_BY_USER(userId)
    let principalRecord = await cacheGet<{ type: string; role: string }>(cacheKey)
    if (!principalRecord) {
      principalRecord =
        (await db.query.principal.findFirst({
          where: eq(principal.userId, userId),
          columns: { type: true, role: true },
        })) ?? null
      if (principalRecord) await cacheSet(cacheKey, principalRecord, 300)
    }

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

  return { baseUrl: config.baseUrl, session, settings, userRole, themeCookie, isCloud: IS_CLOUD }
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
