/**
 * The real `config.baseUrl` getter answers a per-request override, used while
 * a custom domain is paused after the plan limits grace, and nothing outside
 * the store that set it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  workspace: null as { workspaceKey: string; routing: { baseUrl: string } } | null,
}))
vi.mock('@/lib/server/workspaces/workspace-context', async (original) => ({
  ...(await original<typeof import('@/lib/server/workspaces/workspace-context')>()),
  getCurrentWorkspace: () => h.workspace,
}))

import { runWithLogContext } from '@/lib/server/log-context'
import { config, resetConfig } from '@/lib/server/config'
import { workspaceAuthTrustedOrigins } from '@/lib/server/auth/trusted-origins'
import {
  pausedHostnames,
  runWithBaseUrlOverride,
  setRequestBaseUrlOverride,
  setRequestPausedCustomDomain,
} from '../base-url-override'

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
  h.workspace = null
})
afterEach(() => {
  process.env = saved
  resetConfig()
})

describe('config.baseUrl and the base URL override', () => {
  it('answers the configured origin with no override', () => {
    expect(config.baseUrl).toBe('https://feedback.acme.test')
  })

  it('answers the override for the rest of the request that set it', async () => {
    await runWithLogContext({} as never, async () => {
      setRequestBaseUrlOverride('https://acme.example.com')
      await Promise.resolve()
      expect(config.baseUrl).toBe('https://acme.example.com')
    })
    expect(config.baseUrl).toBe('https://feedback.acme.test')
  })

  it('answers the override inside background work only', async () => {
    const inside = await runWithBaseUrlOverride('https://acme.example.com', async () => {
      await Promise.resolve()
      return config.baseUrl
    })
    expect(inside).toBe('https://acme.example.com')
    expect(config.baseUrl).toBe('https://feedback.acme.test')
  })
})

describe('the override and the workspace that set it', () => {
  it('is never read by another workspace sharing the store', async () => {
    h.workspace = { workspaceKey: 'ws_acme', routing: { baseUrl: 'https://feedback.acme.test' } }
    await runWithLogContext({} as never, async () => {
      setRequestPausedCustomDomain({
        origin: 'https://acme.example.com',
        hostnames: ['feedback.acme.test'],
      })
      expect(config.baseUrl).toBe('https://acme.example.com')
      h.workspace = { workspaceKey: 'ws_foo', routing: { baseUrl: 'https://foo.example.com' } }
      expect(config.baseUrl).toBe('https://foo.example.com')
      expect(pausedHostnames().size).toBe(0)
    })
  })
})

describe('trusted origins under the override', () => {
  it('trusts the configured origin and the default origin both', async () => {
    await runWithLogContext({} as never, async () => {
      setRequestBaseUrlOverride('https://acme.example.com')
      const origins = workspaceAuthTrustedOrigins(undefined, {})
      expect(origins).toContain('https://feedback.acme.test')
      expect(origins).toContain('https://acme.example.com')
    })
  })
})
