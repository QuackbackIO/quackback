import type { PortalConfig, PortalAccessConfig } from '@/lib/server/domains/settings/settings.types'

/** Redacted access shape — visibility only. */
type RedactedAccess = Pick<PortalAccessConfig, 'visibility'>

/** Redacted PortalConfig with access stripped to visibility only. */
type RedactedPortalConfig = Omit<PortalConfig, 'access' | 'support'> & {
  access?: RedactedAccess
  support?: Omit<NonNullable<PortalConfig['support']>, 'access'>
}

/**
 * Strips the server-only access policy fields (allowedDomains, widgetSignIn,
 * allowedSegmentIds) from a parsed PortalConfig before returning it to a
 * client-bound context. Keeps access.visibility (already public via
 * publicPortalConfig.portalAccess).
 */
function redactPortalConfig(portalConfig: PortalConfig): RedactedPortalConfig {
  const support = portalConfig.support
    ? {
        enabled: portalConfig.support.enabled,
      }
    : undefined

  if (!portalConfig.access) {
    return support ? { ...portalConfig, support } : portalConfig
  }
  return {
    ...portalConfig,
    ...(support && { support }),
    access: {
      // Only expose visibility — allowedDomains, widgetSignIn, and
      // allowedSegmentIds are server-only policy enforced by evaluateMyPortalAccessFn.
      visibility: portalConfig.access.visibility,
    },
  }
}

/**
 * Strips the server-only access policy fields (allowedDomains, widgetSignIn,
 * allowedSegmentIds) from a settings row before returning it to a client-bound
 * context. Keeps access.visibility (it's already public via
 * publicPortalConfig.portalAccess).
 *
 * Accepts either a parsed PortalConfig object or a JSON-string column (raw DB
 * row). When the field is absent or carries no `access` key it is returned
 * untouched. Handles null/undefined gracefully.
 */
export function redactSettingsForClient<T extends { portalConfig?: PortalConfig | string | null }>(
  row: T
): T {
  const { portalConfig } = row

  if (!portalConfig) return row

  // Parsed object form (TenantSettings.portalConfig)
  if (typeof portalConfig === 'object') {
    if (!portalConfig.access && !portalConfig.support?.access) return row
    // Cast: the shape is identical at runtime; only the access sub-keys differ.
    return { ...row, portalConfig: redactPortalConfig(portalConfig) } as T
  }

  // JSON-string form (raw DB row column)
  if (typeof portalConfig === 'string') {
    try {
      const parsed = JSON.parse(portalConfig) as Partial<PortalConfig>
      if (!parsed.access && !parsed.support?.access) return row
      const redacted = redactPortalConfig(parsed as PortalConfig)
      return { ...row, portalConfig: JSON.stringify(redacted) } as T
    } catch {
      // Unparseable — return as-is; the downstream parser handles the error.
      return row
    }
  }

  return row
}
