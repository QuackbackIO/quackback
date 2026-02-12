import type { TelemetryPayload } from './payload'
import { TELEMETRY_ENDPOINT } from './config'

export async function sendTelemetryPing(payload: TelemetryPayload): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch {
    // Silent failure -- telemetry must never affect application functionality
  } finally {
    clearTimeout(timeout)
  }
}
