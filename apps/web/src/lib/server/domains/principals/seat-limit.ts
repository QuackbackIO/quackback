import { db, settings } from '@/lib/server/db'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { countSeatUsage, type SeatExecutor } from './seat-usage'

/**
 * Lock the settings row on `executor` so concurrent seat-taking writes
 * serialize on it and each counts the others' committed seats. Team
 * additions take it even without a seat cap, so their pending-invite and
 * teammate re-checks are serialized too.
 */
export async function lockSeatLedger(executor: SeatExecutor): Promise<void> {
  const [row] = await executor.select({ id: settings.id }).from(settings).limit(1).for('update')
  if (!row) throw new Error('Workspace is not set up yet')
}

/**
 * Throws TierLimitError when the workspace has hit its seat cap. No-op in
 * OSS (maxTeamSeats is null).
 *
 * Send-time counts members plus pending team invites (an invite holds a
 * seat) and must run on the same transaction as the pending-invite insert.
 * Accept-time passes `convertingInvite` so the invite being claimed is not
 * double-counted: the backstop is whether members already fill the purchased
 * quantity. Pass `executor` to lock the settings row and count on that handle.
 */
export async function enforceSeatLimit(opts?: {
  convertingInvite?: boolean
  executor?: SeatExecutor
}): Promise<void> {
  const limits = await getTierLimits()
  if (limits.maxTeamSeats === null) return

  const executor = opts?.executor
  if (executor) await lockSeatLedger(executor)

  const usage = await countSeatUsage(executor ?? db)
  const current = opts?.convertingInvite ? usage.members : usage.used
  if (current < limits.maxTeamSeats) return

  throw new TierLimitError({
    limit: 'maxTeamSeats',
    current,
    max: limits.maxTeamSeats,
    message: `You've reached your plan's team seats limit (${limits.maxTeamSeats}). Upgrade to add more.`,
  })
}

/**
 * A request that needs more seats than are free. Still a TierLimitError (the
 * upgrade surfaces and the REST 402 envelope key on that), with code
 * SEAT_LIMIT and the counts the caller reports back.
 */
export class SeatLimitError extends TierLimitError {
  readonly needed: number
  readonly free: number

  constructor(opts: { needed: number; free: number; used: number; max: number }) {
    super({
      code: 'SEAT_LIMIT',
      limit: 'maxTeamSeats',
      current: opts.used,
      max: opts.max,
      message: `Not enough seats: this needs ${opts.needed} and ${opts.free} ${
        opts.free === 1 ? 'is' : 'are'
      } free. Upgrade your plan or remove someone to add more.`,
    })
    this.needed = opts.needed
    this.free = opts.free
  }

  override toResponseBody(): Record<string, unknown> {
    return { ...super.toResponseBody(), needed: this.needed, free: this.free }
  }
}

/**
 * Check that `needed` more seats fit, as a whole, before anything is written:
 * a batch either fits entirely or is refused with the needed and free counts.
 * Free seats are the cap minus members and pending team invites. No-op in OSS.
 *
 * Pass the transaction that performs the writes as `executor` to lock the
 * settings row and count on that handle, so racing additions cannot both take
 * the last seats.
 */
export async function assertSeatsAvailable(
  needed: number,
  opts?: { executor?: SeatExecutor }
): Promise<void> {
  if (needed <= 0) return
  const limits = await getTierLimits()
  if (limits.maxTeamSeats === null) return

  const executor = opts?.executor
  if (executor) await lockSeatLedger(executor)

  const usage = await countSeatUsage(executor ?? db)
  const free = Math.max(0, limits.maxTeamSeats - usage.used)
  if (needed <= free) return

  throw new SeatLimitError({ needed, free, used: usage.used, max: limits.maxTeamSeats })
}
