import type { PortalConfig, PortalAccessConfig } from '@/lib/server/domains/settings/settings.types'
import type { StatusSettings } from '@/lib/shared/status-settings'

/** Redacted access shape — visibility only. */
type RedactedAccess = Pick<PortalAccessConfig, 'visibility'>

/** Redacted PortalConfig with access stripped to visibility only. */
type RedactedPortalConfig = Omit<PortalConfig, 'access'> & { access?: RedactedAccess }

/**
 * Strips the server-only access policy fields (allowedDomains, widgetSignIn,
 * allowedSegmentIds) from a parsed PortalConfig before returning it to a
 * client-bound context. Keeps access.visibility (already public via
 * publicPortalConfig.portalAccess).
 */
function redactPortalConfig(portalConfig: PortalConfig): RedactedPortalConfig {
  if (!portalConfig.access) return portalConfig
  return {
    ...portalConfig,
    access: {
      // Only expose visibility — allowedDomains, widgetSignIn, and
      // allowedSegmentIds are server-only policy enforced by evaluateMyPortalAccessFn.
      visibility: portalConfig.access.visibility,
    },
  }
}

/** Public status-page fields. Segment ids and email kill-switch stay server-side. */
type PublicStatusConfig = Pick<StatusSettings, 'enabled' | 'audience' | 'pageDescription'>

function redactStatusConfig(statusConfig: StatusSettings): PublicStatusConfig {
  return {
    enabled: statusConfig.enabled,
    audience: statusConfig.audience,
    pageDescription: statusConfig.pageDescription,
  }
}

function statusConfigNeedsRedaction(statusConfig: StatusSettings): boolean {
  return (
    'allowedSegmentIds' in statusConfig ||
    'emailsDisabled' in statusConfig ||
    'portalTabEnabled' in statusConfig
  )
}

/**
 * Raw settings-row columns that must never reach a client-bound context.
 * `widgetSecret` is the HMAC key that signs widget identify ssoTokens —
 * exposing it lets anyone forge verified identities. The rest are
 * server-side state (tier enforcement, setup progress, metadata config
 * bags) with no client reader.
 *
 * `cloud` sits here alongside `tierLimits` for the same reason and one more:
 * its `billing` sub-block holds provider customer and subscription references,
 * which are account identifiers rather than product config and must never be
 * serialized into a router context or loader payload.
 */
const SERVER_ONLY_SETTINGS_KEYS = [
  'widgetSecret',
  'metadata',
  'tierLimits',
  'cloud',
  'setupState',
] as const

function stripServerOnlyKeys<T extends object>(row: T): T {
  if (!SERVER_ONLY_SETTINGS_KEYS.some((key) => key in row)) return row
  const clean = { ...row } as Record<string, unknown>
  for (const key of SERVER_ONLY_SETTINGS_KEYS) delete clean[key]
  return clean as T
}

/**
 * Strips server-only material from a settings shape before it is returned to
 * a client-bound context (router context, loader data — both are dehydrated
 * into the SSR HTML):
 *
 * - server-only columns of the raw settings row ({@link SERVER_ONLY_SETTINGS_KEYS},
 *   most critically `widgetSecret`);
 * - the access policy fields (allowedDomains, widgetSignIn, allowedSegmentIds)
 *   of `portalConfig`, keeping only access.visibility (already public via
 *   publicPortalConfig.portalAccess);
 * - non-public status-page fields (`allowedSegmentIds`, `emailsDisabled`,
 *   deprecated `portalTabEnabled`) of `statusConfig`.
 *
 * Accepts either the parsed WorkspaceSettings shape or the raw DB row. When the
 * input carries the raw row as a nested `settings` property (WorkspaceSettings
 * does), the row is redacted recursively, so one call at any exit point
 * covers both levels. `portalConfig` may be a parsed object or a JSON-string
 * column. When nothing needs redaction the input is returned by reference.
 */
export function redactSettingsForClient<
  T extends {
    portalConfig?: PortalConfig | string | null
    statusConfig?: StatusSettings | null
  },
>(row: T): T {
  let result = stripServerOnlyKeys(row)

  // WorkspaceSettings shape: the raw DB row rides along as `.settings`.
  const nested = (result as Record<string, unknown>).settings
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const redactedNested = redactSettingsForClient(
      nested as {
        portalConfig?: PortalConfig | string | null
        statusConfig?: StatusSettings | null
      }
    )
    if (redactedNested !== nested) {
      result = result === row ? ({ ...row } as T) : result
      ;(result as Record<string, unknown>).settings = redactedNested
    }
  }

  const { portalConfig, statusConfig } = result

  if (portalConfig) {
    // Parsed object form (WorkspaceSettings.portalConfig)
    if (typeof portalConfig === 'object' && portalConfig.access) {
      // Cast: the shape is identical at runtime; only the access sub-keys differ.
      result = { ...result, portalConfig: redactPortalConfig(portalConfig) } as T
    } else if (typeof portalConfig === 'string') {
      // JSON-string form (raw DB row column)
      try {
        const parsed = JSON.parse(portalConfig) as Partial<PortalConfig>
        if (parsed.access) {
          const redacted = redactPortalConfig(parsed as PortalConfig)
          result = { ...result, portalConfig: JSON.stringify(redacted) } as T
        }
      } catch {
        // Unparseable — leave as-is; the downstream parser handles the error.
      }
    }
  }

  if (statusConfig && statusConfigNeedsRedaction(statusConfig)) {
    result = { ...result, statusConfig: redactStatusConfig(statusConfig) } as T
  }

  return result
}
