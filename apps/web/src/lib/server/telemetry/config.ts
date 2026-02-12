import { config } from '@/lib/server/config'

export const TELEMETRY_ENDPOINT = 'https://telemetry.quackback.io/v1/ping'

export function isEnvTelemetryEnabled(): boolean {
  // DO_NOT_TRACK is a standard env var (https://consoledonottrack.com/)
  if (process.env.DO_NOT_TRACK === '1') return false
  return config.telemetryEnabled !== false
}

export async function isDbTelemetryEnabled(): Promise<boolean> {
  try {
    const { getTelemetryConfig } = await import('@/lib/server/domains/settings/settings.service')
    const telemetryConfig = await getTelemetryConfig()
    return telemetryConfig.enabled
  } catch {
    // DB not ready or settings don't exist yet -- default to enabled
    return true
  }
}

export async function isTelemetryEnabled(): Promise<boolean> {
  if (!isEnvTelemetryEnabled()) return false
  return isDbTelemetryEnabled()
}
