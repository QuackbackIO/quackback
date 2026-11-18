/**
 * An event hook (an email, a notification) builds its links on the default
 * hostname while the custom domain is paused after the plan limits grace:
 * the hook job runs it under the override that the real `config.baseUrl`
 * reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

const seen = vi.hoisted(() => ({ baseUrl: '' }))

vi.mock('../registry', async () => {
  const { config } = await import('@/lib/server/config')
  return {
    getHook: async () => ({
      run: async () => {
        seen.baseUrl = config.baseUrl
        return { success: true }
      },
    }),
  }
})
vi.mock('../test-event', () => ({ isTestEvent: async () => false }))
vi.mock('@/lib/server/domains/settings/settings.plan-limits', () => ({
  readPlanLimitsSources: async () => ({
    cloudIdentity: {
      version: 1,
      displayName: 'Acme',
      canonicalOrigin: 'https://feedback.acme.test',
      platformHostname: 'acme.example.com',
      customDomains: [
        {
          hostname: 'feedback.acme.test',
          readiness: 'ready',
          isPrimary: true,
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    helpCenterDomain: null,
  }),
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { resetConfig } from '@/lib/server/config'
import { runHookJob } from '../hook-job'
import {
  FEATURE_STATES,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  delete process.env.QUACKBACK_TENANCY
  Object.assign(process.env, {
    BASE_URL: 'https://feedback.acme.test',
    SECRET_KEY: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://app@localhost:5432/quackback',
  })
  resetConfig()
})
afterEach(() => {
  process.env = saved
  resetConfig()
})

function job(): ClaimedJob {
  return {
    id: '1',
    jobId: 'job_1',
    queue: 'events',
    dedupeKey: 'evt-1:email:acme',
    payload: {
      hookType: 'email',
      event: {
        id: 'evt-1',
        type: 'post.created',
        timestamp: '2026-11-01T00:00:00.000Z',
        actor: { type: 'user', principalId: 'principal_1' },
        data: {},
      },
      target: {},
      config: {},
    },
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 6,
    leaseToken: '00000000-0000-0000-0000-000000000000',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
}

describe('event hook links and the paused custom domain', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    setFeatureState(state, 'customDomain')
    await runHookJob(job())
    expect(seen.baseUrl).toBe(
      state === 'enforced' ? 'https://acme.example.com' : 'https://feedback.acme.test'
    )
  })
})
