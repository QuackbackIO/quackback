// Telemetry module -- anonymous, privacy-respecting phone-home pings.
//
// - Lives under server/telemetry/ (infrastructure, not a business domain)
// - Uses setInterval (not BullMQ) to avoid Redis dependency for an optional feature
// - Entire module is dynamically imported from bootstrap.ts so it has zero cost when disabled
// - Settings service is dynamically imported to avoid circular deps with the DB proxy
// - Silent failure throughout -- telemetry must never affect application functionality

import { isTelemetryEnabled } from './config'
import { buildPayload } from './payload'
import { sendTelemetryPing } from './sender'

const ONE_DAY = 24 * 60 * 60 * 1000

async function sendPingIfEnabled(): Promise<void> {
  try {
    const enabled = await isTelemetryEnabled()
    if (!enabled) return

    const payload = await buildPayload()
    await sendTelemetryPing(payload)
  } catch {
    // Silent failure
  }
}

export async function startTelemetry(): Promise<void> {
  try {
    const enabled = await isTelemetryEnabled()
    if (!enabled) return

    console.log(
      '[Telemetry] Anonymous usage statistics enabled. ' +
        'Disable with TELEMETRY_ENABLED=false or in Admin > Settings > Telemetry.'
    )

    await sendPingIfEnabled()
    setInterval(() => void sendPingIfEnabled(), ONE_DAY)
  } catch {
    // Silent failure — telemetry must never affect application functionality
  }
}
