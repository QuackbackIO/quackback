/**
 * The control-database pool must release its socket when the fleet is quiet.
 *
 * A readiness probe that ran `SELECT 1` on every poll used to keep this
 * compute billed around the clock. `idle_timeout` is the thing that lets it
 * suspend; a test that only checked the function existed would not notice it
 * dropping off the constructor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const postgresFactory = vi.fn((_url: string, _options?: Record<string, unknown>) => ({
  end: vi.fn(async () => {}),
}))

vi.mock('postgres', () => ({ default: postgresFactory }))

async function loadRegistry() {
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
  return import('../registry')
}

describe('the control-database pool', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeControlSql } = await import('../registry')
    await closeControlSql()
    vi.unstubAllEnvs()
  })

  it('sets idle_timeout above the registry TTL so a used fleet keeps one socket', async () => {
    const { controlIdleSeconds, getControlSql } = await loadRegistry()
    const { config } = await import('@/lib/server/config')
    const idle = controlIdleSeconds()
    expect(idle).toBe(Math.ceil(config.workspaceRegistryTtlMs / 1000) + 15)
    expect(idle).toBeGreaterThan(config.workspaceRegistryTtlMs / 1000)

    getControlSql()
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as {
      max?: number
      idle_timeout?: number
    }
    expect(options.max).toBe(2)
    expect(options.idle_timeout).toBe(idle)
    expect(options.idle_timeout).toBeGreaterThan(0)
  })

  it('tracks the registry TTL when the operator raises it', async () => {
    vi.stubEnv('WORKSPACE_REGISTRY_TTL_MS', '60000')
    const { controlIdleSeconds, getControlSql } = await loadRegistry()
    expect(controlIdleSeconds()).toBe(75)
    getControlSql()
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as { idle_timeout?: number }
    expect(options.idle_timeout).toBe(75)
  })
})
