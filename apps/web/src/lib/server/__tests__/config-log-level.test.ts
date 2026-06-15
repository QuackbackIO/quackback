/**
 * Tests for the LOG_LEVEL config knob.
 */
import { describe, it, expect, afterEach } from 'vitest'

const originalEnv = { ...process.env }

function baseEnv() {
  process.env.DATABASE_URL = 'postgres://localhost/quackback'
  process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long'
  process.env.REDIS_URL = 'redis://localhost:6379'
}

async function freshConfig() {
  const mod = await import('../config')
  mod.resetConfig()
  return mod.config
}

describe('config.logLevel', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("defaults to 'info' in production", async () => {
    process.env = { ...originalEnv }
    baseEnv()
    process.env.NODE_ENV = 'production'
    delete process.env.LOG_LEVEL
    const config = await freshConfig()
    expect(config.logLevel).toBe('info')
  })

  it("defaults to 'debug' outside production", async () => {
    process.env = { ...originalEnv }
    baseEnv()
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL
    const config = await freshConfig()
    expect(config.logLevel).toBe('debug')
  })

  it('honours an explicit LOG_LEVEL', async () => {
    process.env = { ...originalEnv }
    baseEnv()
    process.env.NODE_ENV = 'production'
    process.env.LOG_LEVEL = 'warn'
    const config = await freshConfig()
    expect(config.logLevel).toBe('warn')
  })

  it('rejects an invalid LOG_LEVEL', async () => {
    process.env = { ...originalEnv }
    baseEnv()
    process.env.LOG_LEVEL = 'verbose'
    const config = await freshConfig()
    expect(() => config.logLevel).toThrow('Configuration validation failed')
  })
})
