/**
 * The real `config.baseUrl` getter answers a per-request override, used while
 * a custom domain is paused after the plan limits grace, and nothing outside
 * the store that set it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runWithLogContext } from '@/lib/server/log-context'
import { config, resetConfig } from '@/lib/server/config'
import { runWithBaseUrlOverride, setRequestBaseUrlOverride } from '../base-url-override'

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
