// Telemetry module -- anonymous, privacy-respecting phone-home pings.
//
// - Lives under server/telemetry/ (infrastructure, not a business domain)
// - Uses setInterval (not the job queue) to keep an optional
//   feature self-contained; cross-instance dedupe (once per deployment, not once per
//   replica) is handled by the Postgres-backed sweep lock instead
// - Entire module is dynamically imported from bootstrap.ts so it has zero cost when disabled
// - Silent failure throughout -- telemetry must never affect application functionality

import { withSweepLock } from '@/lib/server/sweep-lock'
import { isTelemetryEnabled } from './config'
import { buildPayload } from './payload'
import { sendTelemetryPing } from './sender'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'telemetry' })

const ONE_HOUR = 60 * 60 * 1000
const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000

async function sendPing(): Promise<void> {
  try {
    const payload = await buildPayload()
    await sendTelemetryPing(payload)
  } catch {
    // Silent failure
  }
}

// Claim the ping via the sweep lock rather than sending directly: with N
// replicas each running their own setInterval, an unguarded ping would fire
// once per replica per day. Ticking hourly against a 23h TTL means one
// replica wins the claim and every other tick across every replica is a
// no-op until the TTL lapses, while a replica that dies mid-cycle is
// covered within an hour by whichever replica claims the lock next --
// instead of the ping silently going dark until that replica restarts.
async function claimPing(): Promise<void> {
  try {
    await withSweepLock('telemetry_ping', TWENTY_THREE_HOURS, sendPing, { keepUntilExpiry: true })
  } catch {
    // Silent failure
  }
}

/**
 * @param opts.once - claim the ping and return, arming no interval. A Railway
 *   cron service is itself the schedule, and a process that armed an hourly
 *   timer would never exit — the one thing a cron service must do.
 */
export async function startTelemetry(opts: { once?: boolean } = {}): Promise<void> {
  try {
    if (!isTelemetryEnabled()) return

    log.info('anonymous usage statistics enabled; disable with DISABLE_TELEMETRY=true')

    await claimPing()
    if (opts.once) return
    setInterval(() => void claimPing(), ONE_HOUR)
  } catch {
    // Silent failure — telemetry must never affect application functionality
  }
}
