import type { TelemetryPayload } from './payload'
import { TELEMETRY_POSTHOG_HOST, TELEMETRY_POSTHOG_KEY } from './config'

export interface PostHogCapture {
  api_key: string
  event: 'instance_ping'
  distinct_id: string
  properties: Record<string, unknown>
}

/**
 * One `instance_ping` event per instance per day. The instance is the
 * distinct id, and `$set` keeps its latest snapshot on its profile so
 * installs can be broken down by version, products and scale without
 * reading event history.
 *
 * The request comes from the server, so its address is the server's. GeoIP is
 * turned off and `$ip` blanked so it never becomes a location.
 *
 * A hosted workspace also joins the `workspace` group its admins' browser
 * analytics use. A self-hosted payload carries no workspace id at all.
 */
export function toPostHogEvent(
  payload: TelemetryPayload,
  opts: { apiKey: string; workspaceId?: string | null }
): PostHogCapture {
  const { instanceId, ...snapshot } = payload
  return {
    api_key: opts.apiKey,
    event: 'instance_ping',
    distinct_id: instanceId,
    properties: {
      ...snapshot,
      $set: snapshot,
      $geoip_disable: true,
      $ip: null,
      $lib: 'quackback-server',
      ...(payload.cloud && opts.workspaceId ? { $groups: { workspace: opts.workspaceId } } : {}),
    },
  }
}

export async function sendTelemetryPing(
  payload: TelemetryPayload,
  workspaceId?: string | null
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    await fetch(`${TELEMETRY_POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPostHogEvent(payload, { apiKey: TELEMETRY_POSTHOG_KEY, workspaceId })),
      signal: controller.signal,
    })
  } catch {
    // Silent failure -- telemetry must never affect application functionality
  } finally {
    clearTimeout(timeout)
  }
}
