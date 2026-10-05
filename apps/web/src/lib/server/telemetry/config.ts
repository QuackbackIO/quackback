import { config } from '@/lib/server/config'

/**
 * Where the anonymous instance ping goes. A project API key can only write
 * events, so it is safe to ship in source.
 */
export const TELEMETRY_POSTHOG_HOST = 'https://us.i.posthog.com'
export const TELEMETRY_POSTHOG_KEY = 'phc_REPLACE_WITH_PROJECT_KEY'

export function isTelemetryEnabled(): boolean {
  return !config.disableTelemetry
}
