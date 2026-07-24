import type { PortalConfig, PortalAccessConfig } from '@/lib/server/domains/settings/settings.types'

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

/**
 * Raw settings-row columns that must never reach a client-bound context.
 * `widgetSecret` is the HMAC key that signs widget identify ssoTokens —
 * exposing it lets anyone forge verified identities. The rest are
 * server-side state (tier enforcement, setup progress, metadata config
 * bags) with no client reader.
 */
const SERVER_ONLY_SETTINGS_KEYS = ['widgetSecret', 'metadata', 'tierLimits', 'setupState'] as const

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
 *   publicPortalConfig.portalAccess).
 *
 * Accepts either the parsed TenantSettings shape or the raw DB row. When the
 * input carries the raw row as a nested `settings` property (TenantSettings
 * does), the row is redacted recursively, so one call at any exit point
 * covers both levels. `portalConfig` may be a parsed object or a JSON-string
 * column. When nothing needs redaction the input is returned by reference.
 */
export function redactSettingsForClient<T extends { portalConfig?: PortalConfig | string | null }>(
  row: T
): T {
  let result = stripServerOnlyKeys(row)

  // TenantSettings shape: the raw DB row rides along as `.settings`.
  const nested = (result as Record<string, unknown>).settings
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const redactedNested = redactSettingsForClient(
      nested as { portalConfig?: PortalConfig | string | null }
    )
    if (redactedNested !== nested) {
      result = result === row ? ({ ...row } as T) : result
      ;(result as Record<string, unknown>).settings = redactedNested
    }
  }

  const { portalConfig } = result

  if (!portalConfig) return result

  // Parsed object form (TenantSettings.portalConfig)
  if (typeof portalConfig === 'object') {
    if (!portalConfig.access) return result
    // Cast: the shape is identical at runtime; only the access sub-keys differ.
    return { ...result, portalConfig: redactPortalConfig(portalConfig) } as T
  }

  // JSON-string form (raw DB row column)
  if (typeof portalConfig === 'string') {
    try {
      const parsed = JSON.parse(portalConfig) as Partial<PortalConfig>
      if (!parsed.access) return result
      const redacted = redactPortalConfig(parsed as PortalConfig)
      return { ...result, portalConfig: JSON.stringify(redacted) } as T
    } catch {
      // Unparseable — return as-is; the downstream parser handles the error.
      return result
    }
  }

  return result
}
