import { config } from '@/lib/server/config'

/**
 * Where the anonymous instance ping goes. A project API key can only write
 * events, so it is safe to ship in source.
 */
export const TELEMETRY_POSTHOG_HOST = 'https://eu.i.posthog.com'
export const TELEMETRY_POSTHOG_KEY = 'phc_y4z48oDToM9abTShgGvPV76AvsynMhvsT9yaAwXbCXch'

export function isTelemetryEnabled(): boolean {
  return !config.disableTelemetry
}
