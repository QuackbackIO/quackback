import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { Role } from '@/lib/shared/roles'
import { isTeamMember, sessionRole, toSessionScope } from '@/lib/shared/roles'
import {
  colorSchemeHintHeaders,
  getThemeCookie,
  parsePrefersColorScheme,
  type Theme,
} from '@/lib/shared/theme'
import { getUpdateBannerDismissedVersionCookie } from '@/lib/shared/update-banner-cookie'
import { resolveLocale, type SupportedLocale } from '@/lib/shared/i18n'
import { starPromptAllowedHere } from '@/lib/server/github-star-prompt'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'
import {
  getSetupState,
  isOnboardingComplete,
  needsCloudOnboardingWizard,
} from '@/lib/shared/db-types'
import type { Session, PrincipalType } from '@/lib/server/auth/session'
import type { WorkspaceSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { resolveCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { logger } from '@/lib/server/logger'
import { runWithoutLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/process-role'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { analyticsWorkspaceKey } from '@/lib/shared/analytics-identity'
import type { SectionLinks } from '@/lib/shared/section-links'

const log = logger.child({ component: 'bootstrap' })

export interface BootstrapData {
  baseUrl: string
  /**
   * The page `/` shows when the request came to a portal section's own
   * hostname (`/hc` on help.acme.com), else null. The root document carries
   * it so the browser's router matches `/` as the server did.
   */
  sectionHome: string | null
  /**
   * Where portal sections are linked, when any is not on the primary domain
   * (help.acme.com), and this page's own host when it is a section's. Only the
   * exception is sent, since this goes into every document: absent, every
   * section and this page are on the base URL. `expandSectionLinks` rebuilds
   * the full table.
   */
  sectionLinks?: SectionLinks
  session: Session | null
  /**
   * The workspace settings as a browser may see them: redacted by
   * `redactSettingsForClient`, and with the raw settings row emptied (every
   * client reader uses the parsed fields beside it).
   */
  settings: WorkspaceSettings | null
  /** Onboarding progress, decided here so the raw setup state never leaves the server. */
  onboarding: { complete: boolean; needsSetupWizard: boolean }
  userRole: Role | null
  /**
   * The admin's address on the primary domain (https://acme.com/admin), sent
   * only to a signed-in, unblocked teammate viewing a section host. The admin
   * does not run there and the session there is portal scope, so `userRole`
   * reads as a portal user's; the portal header links this instead. It is a
   * plain link: it grants nothing, and the session stays portal scope. Absent
   * everywhere else, so no other document changes.
   */
  primaryAdminUrl?: string
  themeCookie: Theme
  /** OS color-scheme preference from the `Sec-CH-Prefers-Color-Scheme` client
   *  hint, used by the root document to resolve a `system` theme during SSR.
   *  null when the browser didn't send the hint (e.g. Firefox/Safari, or a
   *  first visit); the document then resolves it in a <head> script. */
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
  /**
   * Whether the one-time GitHub star prompt and the Help menu's GitHub link may
   * show: self-hosted only, never on the Cloud fleet, and not switched off.
   */
  githubStarPrompt: boolean
  /**
   * Browser product analytics for the admin app, present only when the
   * operator set `POSTHOG_KEY`. `workspaceId` is the opaque group key the
   * admin events and this workspace's instance ping share
   * (see analytics-identity.ts).
   */
  productAnalytics: {
    key: string
    /** Where the SDK sends: PostHog, or a reverse proxy in front of it. */
    apiHost: string
    /** The PostHog app, for toolbar links; null when it cannot be known. */
    uiHost: string | null
    sessionRecording: boolean
    /** Replays hide every text node, not only inputs. */
    maskText: boolean
    /** Replays hide every input value, not only passwords. */
    maskInputs: boolean
    workspaceId: string | null
  } | null
}

// Returns both the session (with principalType) AND the user role from one
// principal read, both shared with every other identity read in the request.
// `teammate` is the principal's own role, read past the session's scope: true
// for an unblocked admin or member signed in on the site (never the widget).
// It decides only whether a link is shown, never what the session may do.
async function getSessionAndRole(): Promise<{
  session: Session | null
  role: Role | null
  teammate?: boolean
}> {
  // Fast-path for unauthenticated requests: if there's no Cookie header at
  // all the request can't possibly carry a session token, so we can skip
  // every dynamic import below + the session lookup. Hot path for every
  // cold-start landing-page hit since the visitor has no cookies.
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const headers = getRequestHeaders()
  if (!headers.get('cookie')) {
    return { session: null, role: null }
  }

  const { getRequestSession, getRequestPrincipal } =
    await import('@/lib/server/auth/request-session')

  try {
    const session = await getRequestSession()

    if (!session?.user) {
      return { session: null, role: null }
    }

    const userId = session.user.id as UserId
    const principalRecord = await getRequestPrincipal(userId)

    const scope = toSessionScope(session.session.scope)

    return {
      session: {
        session: {
          id: session.session.id as SessionId,
          expiresAt: session.session.expiresAt.toISOString(),
          createdAt: session.session.createdAt.toISOString(),
          updatedAt: session.session.updatedAt.toISOString(),
          userId,
          scope,
        },
        user: {
          id: userId,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          image: session.user.image ?? null,
          principalType: (principalRecord?.type as PrincipalType) ?? 'user',
          ...(principalRecord?.type === 'anonymous'
            ? { displayName: principalRecord.displayName ?? null }
            : {}),
          createdAt: session.user.createdAt.toISOString(),
          updatedAt: session.user.updatedAt.toISOString(),
        },
      },
      role: principalRecord ? sessionRole(principalRecord.role as Role, scope) : null,
      teammate:
        scope !== 'widget' &&
        isTeamMember(principalRecord?.role) &&
        principalRecord?.blockedAt == null,
    }
  } catch (error) {
    // During SSR, auth might fail due to env var issues
    // Return null session and let the client retry
    log.error({ err: error }, 'get session failed')
    return { session: null, role: null }
  }
}

/**
 * What of the workspace settings may leave the server. This function's
 * response goes to any browser that asks, signed in or not, on every
 * client-side navigation as well as into the SSR document, so it is scrubbed
 * here rather than by the route that asked.
 */
function clientSafeSettings(settings: WorkspaceSettings): WorkspaceSettings {
  const redacted = redactSettingsForClient(settings)
  return { ...redacted, settings: {} as WorkspaceSettings['settings'] }
}

let _initialized = false

const getBootstrapDataInternal = createServerOnlyFn(async (): Promise<BootstrapData> => {
  const [
    { getWorkspaceSettings },
    { getRegisteredAuthProviders },
    { config },
    { getRequest, getRequestHeaders, setResponseHeader },
    { resolveHelpCenterBaseUrl },
    {
      effectiveSectionDomains,
      helpDomainConfig,
      normalizeHost,
      portalSectionsEnabled,
      sectionHomeForHost,
      sectionOfHost,
    },
    { requestWorkspaceHost },
    { sectionOriginsOf },
    { compactSectionLinks },
  ] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/auth/registered-providers'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
    import('@/lib/server/domains/help-center/help-center-domain.service'),
    import('@/lib/shared/section-domains'),
    import('@/lib/server/workspaces/saas-edge-host'),
    import('@/lib/server/domains/settings/section-links'),
    import('@/lib/shared/section-links'),
  ])

  // Single principal read returns both session.principalType + userRole;
  // run in parallel with the settings fetch.
  const [{ session, role: userRole, teammate }, settings, registeredAuthProviders] =
    await Promise.all([getSessionAndRole(), getWorkspaceSettings(), getRegisteredAuthProviders()])

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

  // Ask for the prefers-color-scheme client hint, so Chromium sends the OS
  // preference with later requests and a `system` theme is rendered here. A
  // document rendered without it (a first visit, Firefox, Safari) resolves the
  // theme in a <head> script instead (see colorSchemeHintHeaders).
  for (const [name, value] of Object.entries(colorSchemeHintHeaders())) {
    setResponseHeader(name, value)
  }
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
  // The host the edge vouches for, never a forwarded header.
  const requestHost = requestWorkspaceHost(getRequest())
  const sectionDomains = effectiveSectionDomains({
    sectionDomains: settings?.portalConfig?.sectionDomains,
    legacyHelpDomain: settings?.helpCenterConfig?.domain,
  })
  const baseUrl = resolveHelpCenterBaseUrl({
    domainConfig: helpDomainConfig(sectionDomains),
    currentHost: requestHost,
    fallback: config.baseUrl,
  })
  const sectionEnabled = settings ? portalSectionsEnabled(settings) : null
  const sectionHome = sectionEnabled
    ? sectionHomeForHost({ host: requestHost, map: sectionDomains, sectionEnabled })
    : null
  const sectionOrigins = sectionOriginsOf(settings, config.baseUrl)
  // A section's host as the router treats it: mapped and on (as for sectionHome).
  const hostSection = sectionOfHost(requestHost, sectionDomains)
  const onSectionHost = hostSection !== null && sectionEnabled?.[hostSection] === true
  const hostOrigin = onSectionHost
    ? `https://${normalizeHost(requestHost)}`
    : sectionOrigins.primary
  const sectionLinks = compactSectionLinks({ origins: sectionOrigins, hostOrigin, baseUrl })
  // The admin runs on the primary domain only (see BootstrapData.primaryAdminUrl).
  const primaryAdminUrl = onSectionHost && teammate ? `${sectionOrigins.primary}/admin` : null
  const cloud = resolveCloudConfig(
    (settings?.settings as { cloud?: StoredCloudConfig | null } | undefined)?.cloud
  )
  const setupState = getSetupState(settings?.settings?.setupState ?? null)

  return {
    baseUrl,
    sectionHome,
    ...(sectionLinks ? { sectionLinks } : {}),
    session,
    settings: settings ? clientSafeSettings(settings) : null,
    onboarding: {
      complete: isOnboardingComplete(setupState),
      needsSetupWizard: needsCloudOnboardingWizard(setupState),
    },
    userRole,
    ...(primaryAdminUrl ? { primaryAdminUrl } : {}),
    themeCookie,
    prefersColorScheme,
    managedFieldPaths: settings?.managedFieldPaths ?? [],
    registeredAuthProviders,
    acceptLanguageLocale,
    updateBannerDismissedVersion,
    billingEnabled: cloud.enabled && (cloud.canUpgrade || cloud.canManageBilling),
    cloudEnabled: cloud.enabled,
    githubStarPrompt: starPromptAllowedHere(cloud.enabled),
    productAnalytics: config.productAnalytics
      ? {
          key: config.productAnalytics.key,
          apiHost: config.productAnalytics.host,
          uiHost: config.productAnalytics.uiHost,
          sessionRecording: config.productAnalytics.sessionRecording,
          maskText: config.productAnalytics.maskText,
          maskInputs: config.productAnalytics.maskInputs,
          workspaceId: await analyticsWorkspaceKey(
            getCurrentWorkspace()?.workspaceKey,
            typeof settings?.settings?.id === 'string' ? settings.settings.id : null
          ),
        }
      : null,
  }
})

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    log.debug('get bootstrap data')
    return await getBootstrapDataInternal()
  }
)
