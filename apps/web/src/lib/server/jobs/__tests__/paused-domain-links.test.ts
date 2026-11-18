/**
 * Every job runs with links on the workspace's default hostname while its
 * custom domain is paused after the plan limits grace: emails and exports
 * built in onboarding, SLA, export, reaction and Slack jobs name the host that
 * serves. The runner is the one seam, so no queue can miss it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupQueues, closeHarness, ensureJobQueueSchema, testDb, uniqueQueue } from './harness'

vi.mock('@/lib/server/db', () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))
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

import { __setJobDefinitionsForTests } from '../definitions'
import { claimJobs, enqueueJob } from '../job-queue'
import { resetJobHandlers, runJob } from '../runner'
import { config, resetConfig } from '@/lib/server/config'
import {
  FEATURE_STATES,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

const created: string[] = []
let saved: NodeJS.ProcessEnv

beforeAll(async () => {
  await ensureJobQueueSchema()
})
beforeEach(() => {
  saved = { ...process.env }
  delete process.env.QUACKBACK_TENANCY
  Object.assign(process.env, {
    BASE_URL: 'https://feedback.acme.test',
    SECRET_KEY: 'x'.repeat(48),
  })
  resetConfig()
})
afterEach(() => {
  process.env = saved
  resetConfig()
  setFeatureState('flagOff')
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
})
afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

describe('job links and the paused custom domain', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    setFeatureState(state, 'customDomain')
    const q = uniqueQueue('paused-domain-links')
    created.push(q)
    const seen: string[] = []
    __setJobDefinitionsForTests([
      {
        name: q,
        maxAttempts: 1,
        leaseMs: 30_000,
        handler: async () => async () => {
          await Promise.resolve()
          seen.push(config.baseUrl)
        },
      },
    ])
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })
    if (!job) throw new Error('fixture fault: the job was not claimed')
    expect(await runJob(job)).toBe('succeeded')
    expect(seen).toEqual([
      state === 'enforced' ? 'https://acme.example.com' : 'https://feedback.acme.test',
    ])
  })
})
