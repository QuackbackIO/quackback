import { SDK_VERSION } from '../../../../../../packages/widget/src/version'

export { SDK_VERSION as CURRENT_WIDGET_SDK_VERSION }

/** Loose semver: `1.2.3`, optional `-prerelease` / `+build`, max 32 chars. */
const SDK_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][0-9A-Za-z.]+)?$/

export function parseWidgetSdkVersion(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 32) return null
  return SDK_VERSION_RE.test(value) ? value : null
}

/**
 * Version to persist from an install ping.
 *
 * - `/api/widget/sdk.js` is served by this instance, so the embed is current.
 * - `/api/widget/config.json?sdk=` is the npm/file SDK reporting its own version.
 *   Missing/invalid `sdk` means a pre-0.1.6 client.
 */
export function sdkVersionFromWidgetRequest(request: Request, current: string): string | null {
  let path = ''
  let sdkParam: string | null = null
  try {
    const url = new URL(request.url)
    path = url.pathname
    sdkParam = url.searchParams.get('sdk')
  } catch {
    return null
  }
  if (path.endsWith('/sdk.js')) return current
  return parseWidgetSdkVersion(sdkParam)
}

function coreParts(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** True when the embed is missing a version or older than this instance's SDK. */
export function widgetSdkNeedsUpdate(
  reported: string | null | undefined,
  current: string
): boolean {
  if (!reported) return true
  const installed = coreParts(reported)
  const latest = coreParts(current)
  if (!installed || !latest) return true
  if (latest[0] !== installed[0]) return latest[0] > installed[0]
  if (latest[1] !== installed[1]) return latest[1] > installed[1]
  return latest[2] > installed[2]
}

export function widgetConnectedStatusLabel(opts: {
  hasWidgetInstalled?: boolean
  widgetSdkNeedsUpdate?: boolean
}): string {
  if (!opts.hasWidgetInstalled) return 'Not detected yet'
  if (opts.widgetSdkNeedsUpdate) return 'Widget connected · SDK update available'
  return 'Widget connected'
}

export function widgetSdkUpdateDescription(
  installed: string | null | undefined,
  current: string | undefined
): string {
  const reported = installed?.trim() || 'unknown'
  const latest = current?.trim() || 'the latest SDK'
  return `Installed SDK ${reported}. Update your embed to ${latest}.`
}
