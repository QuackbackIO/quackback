import { config } from '@/lib/server/config'

export const TELEMETRY_ENDPOINT = 'https://telemetry.quackback.io/v1/ping'

export function isTelemetryEnabled(): boolean {
  return !config.disableTelemetry
}
