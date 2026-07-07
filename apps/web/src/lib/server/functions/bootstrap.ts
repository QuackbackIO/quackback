import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getThemeCookie, parsePrefersColorScheme, type Theme } from '@/lib/shared/theme'
import { resolveLocale, type SupportedLocale } from '@/lib/shared/i18n'
import type { Session, PrincipalType } from '@/lib/server/auth/session'
import type { TenantSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'
import { toIsoString } from '@/lib/shared/utils'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'bootstrap' })
export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
  themeCookie: Theme
  /** OS color-scheme preference from the `Sec-CH-Prefers-Color-Scheme` client
   *  hint, used by the root document to resolve a `system` theme during SSR so
   *  even first-time `system` visitors don't flash. null when the browser
   *  didn't send the hint (e.g. Firefox/Safari, or before it's advertised). */
  prefersColorScheme: 'light' | 'dark' | null
  /** Dot-paths managed by `/etc/quackback/config.yaml`. The matching
   *  in-app form controls render disabled when the path appears here.
   *  Empty list = nothing locked. */
  managedFieldPaths: string[]
  /** Provider IDs that Better-Auth would register at boot — used by
   *  the admin login UI to gate CTAs on actually-usable providers, not
   *  just DB intent. A stale `ssoOidc.enabled=true` with no
   *  `auth_sso` row in `platform_credentials` will NOT include 'sso'
   *  here, so the UI never renders an SSO button that would 404. */
  registeredAuthProviders: string[]
  /** Locale resolved from the request's Accept-Language header, used by the
   *  root document to set `<html lang>`/`dir` during SSR. Resolved here so it
   *  rides the bootstrap request without a separate round-trip. */
  acceptLanguageLocale: SupportedLocale
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
          expiresAt: toIsoString(session.session.expiresAt),
          token: session.session.token,
          createdAt: toIsoString(session.session.createdAt),
          updatedAt: toIsoString(session.session.updatedAt),
          userId,
        },
        user: {
          id: userId,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          image: session.user.image ?? null,
          principalType: (principalRecord?.type as PrincipalType) ?? 'user',
          createdAt: toIsoString(session.user.createdAt),
          updatedAt: toIsoString(session.user.updatedAt),
        },
      },
      role: (principalRecord?.role as 'admin' | 'member' | 'user' | null) ?? null,
    }
  } catch (error) {
    // During SSR, auth might fail due to env var issues
    // Return null session and let the client retry
    log.error({ err: error }, 'get session failed')
    return { session: null, role: null }
  }
}

let _initialized = false

const getBootstrapDataInternal = createServerOnlyFn(async (): Promise<BootstrapData> => {
  const [
    { getTenantSettings },
    { getRegisteredAuthProviders },
    { config },
    { getRequestHeaders, setResponseHeader },
  ] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/auth/registered-providers'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
  ])

  // Single principal read returns both session.principalType + userRole;
  // run in parallel with the settings fetch.
  const [{ session, role: userRole }, settings, registeredAuthProviders] = await Promise.all([
    getSessionAndRole(),
    getTenantSettings(),
    getRegisteredAuthProviders(),
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
  const acceptLanguageLocale = resolveLocale(headers.get('accept-language'))

  // Advertise the prefers-color-scheme client hint so the browser tells us the
  // OS preference. Critical-CH makes Chromium retry the very first navigation
  // with the hint attached, so even a first-time `system` visitor gets the
  // right theme server-rendered (one extra request, once per origin). Browsers
  // that don't support it (Firefox/Safari) ignore it and fall back to the
  // `color-scheme: light dark` canvas.
  setResponseHeader('Accept-CH', 'Sec-CH-Prefers-Color-Scheme')
  setResponseHeader('Critical-CH', 'Sec-CH-Prefers-Color-Scheme')
  // This document is keyed on every input we render into it: the `theme` cookie
  // (and the session/role embedded in the dehydrated context), Accept-Language
  // for `<html lang>`/`dir`, and the color-scheme hint. List them all so a
  // shared cache can never serve e.g. a dark-cookie document to a no-cookie
  // visitor that happens to share the same hint.
  setResponseHeader('Vary', 'Cookie, Accept-Language, Sec-CH-Prefers-Color-Scheme')
  const prefersColorScheme = parsePrefersColorScheme(headers.get('sec-ch-prefers-color-scheme'))

  return {
    baseUrl: config.baseUrl,
    session,
    settings,
    userRole,
    themeCookie,
    prefersColorScheme,
    managedFieldPaths: settings?.managedFieldPaths ?? [],
    registeredAuthProviders,
    acceptLanguageLocale,
  }
})

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    log.debug('get bootstrap data')
    try {
      return await getBootstrapDataInternal()
    } catch (error) {
      log.error({ err: error }, 'get bootstrap data failed')
      throw error
    }
  }
)
