/**
 * The Home checklist offers "Set up Quinn" only where Quinn can answer. The
 * status reports that as `features.assistant`: the plan includes the AI
 * assistant and an AI model is configured. Without it the step would read done
 * from the deployment defaults while Quinn cannot reply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => ({}) }))

const hoisted = vi.hoisted(() => ({
  entitled: true,
  configured: true,
  assistant: undefined as { enabled?: boolean; respond?: boolean } | undefined,
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({ principal: { id: 'principal_1', role: 'admin' } })),
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/server/db', async (importOriginal) => {
  const empty = { findFirst: vi.fn(async () => undefined), findMany: vi.fn(async () => []) }
  const select = { from: () => ({ where: async () => [] }) }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      query: {
        settings: {
          findFirst: vi.fn(async () => ({
            setupState: null,
            managedFieldPaths: [],
            featureFlags: '{}',
          })),
        },
        boards: empty,
        integrations: empty,
        helpCenterArticles: empty,
        changelogEntries: empty,
        statusComponents: empty,
      },
      select: () => select,
    },
  }
})
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: async () => ({ enabled: true, messenger: { assistant: hoisted.assistant } }),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ maxBoards: null, features: { integrations: true } }),
}))
vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  hasEntitlement: async (key: string) => (key === 'aiAssistant' ? hoisted.entitled : true),
}))
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: () => hoisted.configured,
}))
vi.mock('@/lib/server/activation-wins', () => ({
  detectFirstWin: async () => ({ reached: false, reachedAt: null }),
  winOutcome: () => null,
  internalWinScope: async () => null,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { fetchOnboardingStatus } from '../admin'

const status = () =>
  (
    fetchOnboardingStatus as unknown as () => Promise<{
      hasAgentAnswering: boolean
      features: { assistant: boolean }
    }>
  )()

describe('fetchOnboardingStatus Quinn availability', () => {
  beforeEach(() => {
    hoisted.entitled = true
    hoisted.configured = true
    hoisted.assistant = undefined
  })

  it('reports Quinn available when the plan includes it and a model is configured', async () => {
    expect((await status()).features.assistant).toBe(true)
  })

  it('reports Quinn unavailable when the plan lacks the AI assistant', async () => {
    hoisted.entitled = false
    expect((await status()).features.assistant).toBe(false)
  })

  it('reports Quinn unavailable when no AI model is configured', async () => {
    hoisted.configured = false
    expect((await status()).features.assistant).toBe(false)
  })

  it('reads answering from the deployment, on by default', async () => {
    expect((await status()).hasAgentAnswering).toBe(true)
    hoisted.assistant = { enabled: true, respond: false }
    expect((await status()).hasAgentAnswering).toBe(false)
    hoisted.assistant = { enabled: false }
    expect((await status()).hasAgentAnswering).toBe(false)
  })
})
