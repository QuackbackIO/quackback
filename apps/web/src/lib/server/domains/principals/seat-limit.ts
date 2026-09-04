import { db, settings } from '@/lib/server/db'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { countSeatUsage, type SeatExecutor } from './seat-usage'

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
  // Catalogue billedPer is a control-plane round-trip (10s timeout). Resolve
  // it before FOR UPDATE so CP latency cannot hold the settings-row lock.
  const billedPer = executor
    ? await billedPerIfAlreadyAtCap(limits.maxTeamSeats, opts?.convertingInvite, executor)
    : undefined

  if (executor) {
    const [row] = await executor.select({ id: settings.id }).from(settings).limit(1).for('update')
    if (!row) throw new Error('Workspace is not set up yet')
  }

  const usage = await countSeatUsage(executor ?? db)
  const current = opts?.convertingInvite ? usage.members : usage.used
  if (current < limits.maxTeamSeats) return

  throw new TierLimitError({
    limit: 'maxTeamSeats',
    current,
    max: limits.maxTeamSeats,
    message: seatCapMessage(
      limits.maxTeamSeats,
      billedPer ?? (executor ? undefined : await resolveSeatBilledPer())
    ),
  })
}

async function billedPerIfAlreadyAtCap(
  limit: number,
  convertingInvite: boolean | undefined,
  executor: SeatExecutor
): Promise<'seat' | 'workspace' | undefined> {
  const peek = await countSeatUsage(executor)
  const current = convertingInvite ? peek.members : peek.used
  if (current < limit) return undefined
  return resolveSeatBilledPer()
}

async function resolveSeatBilledPer(): Promise<'seat' | 'workspace' | undefined> {
  try {
    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const { catalogueBilledPer } = await import('@/lib/server/domains/billing/projection-overview')
    const cloud = await getCloudConfig()
    if (cloud.enabled && cloud.plan && cloud.plan !== 'free' && !cloud.trialActive) {
      return await catalogueBilledPer(cloud.plan)
    }
  } catch {
    // Missing catalogue uses the generic upgrade sentence.
  }
  return undefined
}

function seatCapMessage(limit: number, billedPer: 'seat' | 'workspace' | undefined): string {
  if (billedPer === 'seat') {
    return `All ${limit} seats are in use. Add a seat to invite more.`
  }
  return `You've reached your plan's team seats limit (${limit}). Upgrade to add more.`
}
