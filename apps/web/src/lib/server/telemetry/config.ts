import { config } from '@/lib/server/config'

/**
 * Where the anonymous instance ping goes. A project API key can only write
 * events, so it is safe to ship in source.
 */
export const TELEMETRY_POSTHOG_HOST = 'https://eu.i.posthog.com'
export const TELEMETRY_POSTHOG_KEY = 'phc_y4z48oDToM9abTShgGvPV76AvsynMhvsT9yaAwXbCXch'

/**
 * Only a production build outside CI pings. A dev server, an e2e run or a CI
 * job starts on a fresh database, so each one would show up as a new install
 * that pings once and disappears. Production builds bake `NODE_ENV` in as
 * `production`, so this never silences a real install.
 */
export function shouldSendTelemetry(env: {
  disabled: boolean
  isProd: boolean
  ci: string | undefined
}): boolean {
  if (env.disabled || !env.isProd) return false
  const ci = env.ci?.trim().toLowerCase()
  return !ci || ci === 'false' || ci === '0'
}

export function isTelemetryEnabled(): boolean {
  return shouldSendTelemetry({
    disabled: !!config.disableTelemetry,
    isProd: config.isProd,
    ci: process.env.CI,
  })
}
