import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { countSeatUsage } from './seat-usage'

/**
 * Throws TierLimitError when the workspace has hit its seat cap. No-op in
 * OSS (maxTeamSeats is null).
 *
 * Send-time counts members plus pending team invites (an invite holds a
 * seat). Accept-time passes `convertingInvite` so the invite being claimed
 * is not double-counted: the backstop is whether members already fill the
 * purchased quantity.
 */
export async function enforceSeatLimit(opts?: { convertingInvite?: boolean }): Promise<void> {
  const limits = await getTierLimits()
  if (limits.maxTeamSeats === null) return

  const usage = await countSeatUsage()
  const current = opts?.convertingInvite ? usage.members : usage.used
  if (current < limits.maxTeamSeats) return

  throw new TierLimitError({
    limit: 'maxTeamSeats',
    current,
    max: limits.maxTeamSeats,
    message: await seatCapMessage(limits.maxTeamSeats),
  })
}

async function seatCapMessage(limit: number): Promise<string> {
  try {
    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const cloud = await getCloudConfig()
    if (cloud.enabled && cloud.plan && cloud.plan !== 'free' && !cloud.trialActive) {
      return `All ${limit} seats are in use. Add a seat to invite more.`
    }
  } catch {
    // Fall through to the generic upgrade sentence.
  }
  return `You've reached your plan's team seats limit (${limit}). Upgrade to add more.`
}
