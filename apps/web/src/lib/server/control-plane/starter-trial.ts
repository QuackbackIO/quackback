import type { SetupState } from '@/lib/shared/db-types'
import { getSetupState } from '@/lib/shared/db-types'
import { hasLivePaidSub } from '@/lib/shared/billing/trial-state'
import { logger } from '@/lib/server/logger'
import { emitPlgEvent } from '@/lib/server/plg-events'

const log = logger.child({ component: 'starter-trial' })

export type StarterTrialEvidence = {
  idempotencyKey: string
  resolution: 'created' | 'configured'
  artifactType: 'board' | 'messenger' | 'article'
  occurredAt: string
}

/** Same evidence a wizard retry would send. Null when the starter cannot start a trial. */
export function starterTrialEvidence(state: SetupState): StarterTrialEvidence | null {
  const starting = state.steps.startingPoint
  if (!starting) return null
  if (starting.resolution !== 'created' && starting.resolution !== 'configured') return null
  if (starting.resourceType === 'none') return null
  const occurredAt = state.completedAt ?? starting.completedAt
  if (!occurredAt) return null
  return {
    idempotencyKey: `starter:${occurredAt}:${starting.resourceType}`,
    resolution: starting.resolution,
    artifactType: starting.resourceType,
    occurredAt,
  }
}

/**
 * Re-report stamped starter evidence when Cloud is on and no trial has landed
 * locally. A control-plane outage at wizard completion must not permanently
 * skip the starter Pro trial.
 *
 * Complimentary grants and paid plans omit trial timestamps by design, so
 * `trialStartedAt` being null is not "starter still due". Retrying
 * `/billing/activate-trial` on every admin refresh would stall the page if
 * the control plane is down, and `already_started` never stamps dates onto
 * a grant so later calls would never suppress.
 */
export async function reportStarterTrialIfDue(identity?: {
  principalId: string
}): Promise<'started' | 'already_started' | 'skipped'> {
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  if (!cloud.enabled || cloud.trialStartedAt) return 'skipped'
  // Canceled is not live: upgradeContextFor still offers a trial on Free.
  if (hasLivePaidSub(cloud.subscriptionStatus)) return 'skipped'
  if (cloud.plan && cloud.plan !== 'free' && !cloud.trialActive) return 'skipped'

  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()
  const row = workspace?.settings as { id?: string; setupState?: string | null } | undefined
  const state = getSetupState(row?.setupState ?? null)
  const evidence = state ? starterTrialEvidence(state) : null
  if (!evidence) return 'skipped'

  try {
    const { reportTrialActivation } = await import('@/lib/server/control-plane/client')
    const status = await reportTrialActivation(evidence)
    if (status === 'started' && identity && row?.id && state?.useCase) {
      await emitPlgEvent(
        {
          name: 'trial_started',
          outcome: state.useCase,
          artifactType: evidence.artifactType,
        },
        { workspaceId: row.id, principalId: identity.principalId }
      )
    }
    return status
  } catch (error) {
    log.error({ err: error }, 'trial activation could not be reported; admin continues')
    return 'skipped'
  }
}
