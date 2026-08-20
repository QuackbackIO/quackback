import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { Role } from '@/lib/shared/roles'
import { getThemeCookie, parsePrefersColorScheme, type Theme } from '@/lib/shared/theme'
import { getUpdateBannerDismissedVersionCookie } from '@/lib/shared/update-banner-cookie'
import { resolveLocale, type SupportedLocale } from '@/lib/shared/i18n'
import type { Session, PrincipalType } from '@/lib/server/auth/session'
import type { WorkspaceSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { resolveCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { logger } from '@/lib/server/logger'
import { runWithoutLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/process-role'

const log = logger.child({ component: 'bootstrap' })

export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: WorkspaceSettings | null
  userRole: Role | null
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
  /** Version string the admin update banner was dismissed for, read from the
   *  `update_banner_dismissed_version` cookie, or null if never dismissed.
   *  Threaded into the admin route the same way `themeCookie` is, so the
   *  banner renders in its final expanded/collapsed state on first paint. */
  updateBannerDismissedVersion: string | null
  /**
   * Whether this workspace has a valid control-plane billing projection.
   *
   * A single boolean, and deliberately nothing more: the admin settings nav
   * needs to know whether a Billing item exists, and nothing else on the
   * client is entitled to a billing fact. No customer reference, no
   * subscription reference, no plan, no price — every one of those stays
   * server-side, and `settings.cloud` remains in `SERVER_ONLY_SETTINGS_KEYS`.
   *
   * False on every self-hosted install. Provider configuration is never read
   * by the workspace application.
   */
  billingEnabled: boolean
  /**
   * Whether this workspace has a signed cloud identity projection.
   * Gates the Settings Domains row. False on every self-hosted install.
   */
  cloudEnabled: boolean
}

// Returns both the session (with principalType) AND the user role in
// one principal-table query — avoids the duplicate read the caller
// previously did to compute role separately. Saves one round-trip per
// page render for authenticated users.
async function getSessionAndRole(): Promise<{
  session: Session | null
  role: Role | null
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
    import('@/lib/server/cache'),
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
      role: (principalRecord?.role as Role | null) ?? null,
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
    { getWorkspaceSettings },
    { getRegisteredAuthProviders },
    { config },
    { getRequestHeaders, setResponseHeader },
    { resolveHelpCenterBaseUrl },
  ] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/auth/registered-providers'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
    import('@/lib/server/domains/help-center/help-center-domain.service'),
  ])

  // Single principal read returns both session.principalType + userRole;
  // run in parallel with the settings fetch.
  const [{ session, role: userRole }, settings, registeredAuthProviders] = await Promise.all([
    getSessionAndRole(),
    getWorkspaceSettings(),
    getRegisteredAuthProviders(),
  ])

  // One-time initialization on first request.
  //
  // Role-gated, and the gate is not cosmetic. Telemetry is default-on and this
  // path had none, so a `role=web` replica walked every workspace in the registry
  // once an hour — which is precisely what SAAS-HOSTING-STACK.md §1's
  // scale-to-zero argument says a web replica does not do ("a QUACKBACK_ROLE=web
  // replica runs none of them"), and what Piece 2 measured. Fixing the
  // wrong-workspace problem by making the sweep fleet-wide widened its blast
  // radius from one workspace's database to every workspace's, including on replicas
  // that must stay silent to let their computes suspend.
  //
  // `shouldRunWorkers()` is the same predicate `startup.ts` gates the sweepers
  // behind, so telemetry now lives on the same side of the split as the rest
  // of the background work.
  if (!_initialized && shouldRunWorkers()) {
    _initialized = true

    // Delay telemetry to let the DB connection initialize
    setTimeout(() => {
      // Detached from the request that happened to arm it.
      //
      // AsyncLocalStorage carries the arming request's store into this timer,
      // into `startTelemetry`, and into the hourly `setInterval` it arms — for
      // the life of the process. Under pooled tenancy that store carries the
      // WORKSPACE SCOPE, and `withSweepLock` fans a tick across the fleet only
      // when no scope is active. So without this, whichever workspace rendered the
      // pod's first page would own the fleet's telemetry forever: the hourly
      // claim would take the lock in *its* database, no other workspace would ever
      // be pinged, and `telemetry/instance-id.ts` would keep issuing an
      // unlocked read-modify-write of *its* `settings.metadata` — the write
      // SAAS-HOSTING-STACK.md §3 names as able to drop the fingerprint stamp.
      //
      // `_initialized` itself is fine shared: it is a once-per-process latch,
      // and process-lifetime is exactly what it should mean. The bug was that
      // the work it gates inherited a request's identity.
      void runWithoutLogContext(async () => {
        try {
          const { startTelemetry } = await import('@/lib/server/telemetry')
          await startTelemetry()
        } catch {
          // Silent failure -- telemetry must never affect the application
        }
      })
    }, 10_000)
  }

  const headers = getRequestHeaders()
  const themeCookie = getThemeCookie(headers.get('cookie') ?? null)
  const updateBannerDismissedVersion = getUpdateBannerDismissedVersionCookie(
    headers.get('cookie') ?? null
  )
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
  // for `<html lang>`/`dir`, the color-scheme hint, and now Host (below,
  // baseUrl switches to the help center's verified custom domain when the
  // request arrives on it). List them all so a shared cache can never serve
  // e.g. a dark-cookie document to a no-cookie visitor that happens to share
  // the same hint.
  setResponseHeader('Vary', 'Cookie, Accept-Language, Sec-CH-Prefers-Color-Scheme, Host')
  const prefersColorScheme = parsePrefersColorScheme(headers.get('sec-ch-prefers-color-scheme'))

  // Canonical URLs switch to the help center's custom domain when the
  // request actually arrived on it (domains/languages §1) -- everywhere else
  // (boards, changelog, etc.) this is a no-op and baseUrl is just BASE_URL.
  const baseUrl = resolveHelpCenterBaseUrl({
    domainConfig: settings?.helpCenterConfig?.domain,
    currentHost: headers.get('host'),
    fallback: config.baseUrl,
  })
  const cloud = resolveCloudConfig(
    (settings?.settings as { cloud?: StoredCloudConfig | null } | undefined)?.cloud
  )

  return {
    baseUrl,
    session,
    settings,
    userRole,
    themeCookie,
    prefersColorScheme,
    managedFieldPaths: settings?.managedFieldPaths ?? [],
    registeredAuthProviders,
    acceptLanguageLocale,
    updateBannerDismissedVersion,
    billingEnabled: cloud.enabled && (cloud.canUpgrade || cloud.canManageBilling),
    cloudEnabled: cloud.enabled,
  }
})

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    log.debug('get bootstrap data')
    return await getBootstrapDataInternal()
  }
)
