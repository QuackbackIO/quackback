/**
 * `POSTHOG_KEY`: browser product analytics for the admin app. Nothing loads
 * unless an operator sets it; `DISABLE_TELEMETRY` is a separate switch for
 * the anonymous instance ping and does not touch it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
  },
}))

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  for (const key of [
    'QUACKBACK_TENANCY',
    'POSTHOG_KEY',
    'POSTHOG_HOST',
    'POSTHOG_SESSION_RECORDING',
    'DISABLE_TELEMETRY',
  ]) {
    delete process.env[key]
  }
  Object.assign(process.env, {
    BASE_URL: 'https://app.example.com',
    SECRET_KEY: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://app@localhost:5432/quackback',
  })
})

afterEach(() => {
  process.env = saved
})

async function load() {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  return config.productAnalytics
}

describe('product analytics config', () => {
  it('is off when POSTHOG_KEY is unset or empty', async () => {
    expect(await load()).toBeNull()
    process.env.POSTHOG_KEY = ''
    expect(await load()).toBeNull()
  })

  it('defaults to the US host with session replay on', async () => {
    process.env.POSTHOG_KEY = 'phc_abc'
    expect(await load()).toEqual({
      key: 'phc_abc',
      host: 'https://us.i.posthog.com',
      sessionRecording: true,
    })
  })

  it('takes a host without its trailing slash, and replay can be turned off', async () => {
    Object.assign(process.env, {
      POSTHOG_KEY: 'phc_abc',
      POSTHOG_HOST: 'https://eu.i.posthog.com/',
      POSTHOG_SESSION_RECORDING: 'false',
    })
    expect(await load()).toEqual({
      key: 'phc_abc',
      host: 'https://eu.i.posthog.com',
      sessionRecording: false,
    })
  })

  it('is independent of DISABLE_TELEMETRY', async () => {
    Object.assign(process.env, { POSTHOG_KEY: 'phc_abc', DISABLE_TELEMETRY: 'true' })
    expect(await load()).toMatchObject({ key: 'phc_abc' })
  })
})
