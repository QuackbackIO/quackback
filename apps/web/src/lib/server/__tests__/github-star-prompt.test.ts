import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  settings: null as { setupState: string | null; createdAt: Date } | null,
  cloud: false,
  metadata: null as string | null,
  queries: 0,
  setupComplete: false,
  pooled: false,
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return hoisted.pooled
    },
  },
}))

vi.mock('@/lib/shared/db-types', async (original) => ({
  ...(await original<typeof import('@/lib/shared/db-types')>()),
  isOnboardingComplete: () => hoisted.setupComplete,
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => hoisted.settings,
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: async () => ({ enabled: hoisted.cloud }),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: { user: { findFirst: async () => ({ metadata: hoisted.metadata }) } },
    execute: async () => {
      hoisted.queries += 1
      return []
    },
  },
}))

import {
  getStarPromptStage,
  isStarPromptDisabled,
  logFirstBootStarLine,
  starPromptAllowedHere,
} from '../github-star-prompt'
import type { PrincipalId, UserId } from '@quackback/ids'

const DAY = 24 * 60 * 60 * 1000
const USER = 'user_x' as UserId
const PRINCIPAL = 'principal_01h455vb4pex5vsknk084sn02q' as PrincipalId

describe('the GitHub star prompt switch and first-boot line', () => {
  beforeEach(() => {
    hoisted.settings = { setupState: null, createdAt: new Date(Date.now() - 60 * DAY) }
    hoisted.cloud = false
    hoisted.metadata = null
    hoisted.queries = 0
    hoisted.setupComplete = false
    hoisted.pooled = false
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is switched off by DISABLE_GITHUB_STAR_PROMPT', () => {
    expect(isStarPromptDisabled({})).toBe(false)
    expect(isStarPromptDisabled({ DISABLE_GITHUB_STAR_PROMPT: 'true' })).toBe(true)
    expect(isStarPromptDisabled({ DISABLE_GITHUB_STAR_PROMPT: ' TRUE ' })).toBe(true)
    expect(isStarPromptDisabled({ DISABLE_GITHUB_STAR_PROMPT: '1' })).toBe(true)
    expect(isStarPromptDisabled({ DISABLE_GITHUB_STAR_PROMPT: 'false' })).toBe(false)
  })

  it('never asks on Cloud, when switched off, or once asked, without reading activity', async () => {
    hoisted.cloud = true
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    hoisted.cloud = false
    vi.stubEnv('DISABLE_GITHUB_STAR_PROMPT', 'true')
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    vi.unstubAllEnvs()
    hoisted.metadata = JSON.stringify({ _onboarding: { githubStarPromptAt: 'x' } })
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    hoisted.metadata = null
    hoisted.settings = { setupState: null, createdAt: new Date(Date.now() - 5 * DAY) }
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    expect(hoisted.queries).toBe(0)
  })

  it('never asks on the Cloud fleet, even for a workspace whose billing record is missing', async () => {
    hoisted.pooled = true
    expect(starPromptAllowedHere(false)).toBe(false)
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    hoisted.pooled = false
    expect(starPromptAllowedHere(false)).toBe(true)
    expect(starPromptAllowedHere(true)).toBe(false)
    vi.stubEnv('DISABLE_GITHUB_STAR_PROMPT', 'true')
    expect(starPromptAllowedHere(false)).toBe(false)
  })

  it('reads activity once the cheap checks pass', async () => {
    expect(await getStarPromptStage(USER, PRINCIPAL)).toBeNull()
    expect(hoisted.queries).toBe(2)
  })

  it('logs the repo on first boot only', async () => {
    const info = vi.fn()
    await logFirstBootStarLine({ info })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]?.[0]).toEqual({ url: 'https://github.com/QuackbackIO/quackback' })

    info.mockClear()
    hoisted.setupComplete = true
    await logFirstBootStarLine({ info })
    expect(info).not.toHaveBeenCalled()

    hoisted.setupComplete = false
    vi.stubEnv('DISABLE_GITHUB_STAR_PROMPT', 'true')
    await logFirstBootStarLine({ info })
    expect(info).not.toHaveBeenCalled()
  })
})
