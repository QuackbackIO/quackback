import { describe, expect, it } from 'vitest'
import type { OutcomeTaskResolutions } from '@/lib/shared/db-types'
import {
  buildLaunchTasks,
  launchResolutionKey,
  withLaunchTaskResolution,
  type LaunchStatus,
} from '../launch-checklist'

const AT = '2026-10-03T10:00:00.000Z'

const privateFeedbackAndSupport: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: false,
  hasInternalBoard: true,
  memberCount: 1,
  hasBranding: false,
  goals: ['product_feedback', 'customer_support'],
  useCase: 'product_feedback',
  feedbackPrivate: true,
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: false,
    changelog: true,
  },
}

function task(status: LaunchStatus, id: string) {
  const found = buildLaunchTasks(status).find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no ${id} task`)
  return found
}

describe('launch-plan skips live under one key', () => {
  it('uses the primary goal as the key, never the private-feedback alias', () => {
    expect(launchResolutionKey(privateFeedbackAndSupport)).toBe('product_feedback')
    expect(launchResolutionKey({ goals: ['status_page', 'help_center'] })).toBe('status_page')
    expect(launchResolutionKey({ useCase: 'customer_support' })).toBe('customer_support')
    expect(launchResolutionKey({})).toBe('product_feedback')
  })

  it('reads a skip stored under the primary goal for shared polish with private feedback', () => {
    const status: LaunchStatus = {
      ...privateFeedbackAndSupport,
      taskResolutions: {
        product_feedback: { 'invite-team': { resolution: 'dismissed', resolvedAt: AT } },
      },
    }
    expect(task(status, 'invite-team').isSkipped).toBe(true)
  })

  it.each(['invite-team', 'connect-messenger', 'customize-branding'])(
    'a skip of %s saved for private feedback and Support hides it, and undo brings it back',
    (taskId) => {
      expect(task(privateFeedbackAndSupport, taskId).isSkipped).toBe(false)
      const skipped = withLaunchTaskResolution(privateFeedbackAndSupport, taskId, {
        resolution: 'dismissed',
        resolvedAt: AT,
      })
      expect(Object.keys(skipped ?? {})).toEqual(['product_feedback'])
      const afterSkip = { ...privateFeedbackAndSupport, taskResolutions: skipped }
      expect(task(afterSkip, taskId).isSkipped).toBe(true)

      const undone = withLaunchTaskResolution(afterSkip, taskId, null)
      expect(task({ ...afterSkip, taskResolutions: undone }, taskId).isSkipped).toBe(false)
    }
  )

  it('reads skips saved before goals under the private-feedback alias, and undo clears them', () => {
    const legacy: OutcomeTaskResolutions = {
      internal: { 'invite-team': { resolution: 'dismissed', resolvedAt: AT } },
    }
    const status = { ...privateFeedbackAndSupport, taskResolutions: legacy }
    expect(task(status, 'invite-team').isSkipped).toBe(true)
    const undone = withLaunchTaskResolution(status, 'invite-team', null)
    expect(undone).toBeUndefined()
    expect(task({ ...status, taskResolutions: undone }, 'invite-team').isSkipped).toBe(false)
  })

  it('ignores skips kept for a goal the workspace no longer leads with', () => {
    const status: LaunchStatus = {
      ...privateFeedbackAndSupport,
      taskResolutions: {
        help_center: { 'invite-team': { resolution: 'dismissed', resolvedAt: AT } },
      },
    }
    expect(task(status, 'invite-team').isSkipped).toBe(false)
  })

  it('keeps other goals and tasks when it writes', () => {
    const existing: OutcomeTaskResolutions = {
      product_feedback: { 'connect-integration': { resolution: 'dismissed', resolvedAt: AT } },
      help_center: { 'help-article': { resolution: 'dismissed', resolvedAt: AT } },
    }
    expect(
      withLaunchTaskResolution(
        { ...privateFeedbackAndSupport, taskResolutions: existing },
        'invite-team',
        { resolution: 'dismissed', resolvedAt: AT }
      )
    ).toEqual({
      product_feedback: {
        'connect-integration': { resolution: 'dismissed', resolvedAt: AT },
        'invite-team': { resolution: 'dismissed', resolvedAt: AT },
      },
      help_center: { 'help-article': { resolution: 'dismissed', resolvedAt: AT } },
    })
  })
})
