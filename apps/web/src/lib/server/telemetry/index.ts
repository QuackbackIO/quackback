// Telemetry module -- anonymous, privacy-respecting phone-home pings.
//
// - Lives under server/telemetry/ (infrastructure, not a business domain)
// - Uses setInterval (not BullMQ) to avoid Redis dependency for an optional feature
// - Entire module is dynamically imported from bootstrap.ts so it has zero cost when disabled
// - Silent failure throughout -- telemetry must never affect application functionality

import { isTelemetryEnabled } from './config'
import { buildPayload } from './payload'
import { sendTelemetryPing } from './sender'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'telemetry' })

const ONE_DAY = 24 * 60 * 60 * 1000

async function sendPing(): Promise<void> {
  try {
    const payload = await buildPayload()
    await sendTelemetryPing(payload)
  } catch {
    // Silent failure
  }
}

export async function startTelemetry(): Promise<void> {
  try {
    if (!isTelemetryEnabled()) return

    log.info('anonymous usage statistics enabled; disable with DISABLE_TELEMETRY=true')

    await sendPing()
    setInterval(() => void sendPing(), ONE_DAY)
  } catch {
    // Silent failure — telemetry must never affect application functionality
  }
}
