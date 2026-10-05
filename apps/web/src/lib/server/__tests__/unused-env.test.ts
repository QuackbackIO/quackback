import { describe, expect, it, vi } from 'vitest'
import { logUnusedRedisUrl } from '../unused-env'

describe('logUnusedRedisUrl', () => {
  it('logs one info line saying REDIS_URL is unused and removable', () => {
    const log = { info: vi.fn() }
    expect(logUnusedRedisUrl(log, { REDIS_URL: 'redis://redis:6379' })).toBe(true)
    expect(log.info).toHaveBeenCalledTimes(1)
    const [, msg] = log.info.mock.calls[0]
    expect(msg).toMatch(/REDIS_URL/)
    expect(msg).toMatch(/not used/)
    expect(msg).toMatch(/removed/)
    expect(msg).not.toContain('redis://redis:6379')
  })

  it('stays silent when REDIS_URL is unset or blank', () => {
    const log = { info: vi.fn() }
    expect(logUnusedRedisUrl(log, {})).toBe(false)
    expect(logUnusedRedisUrl(log, { REDIS_URL: '  ' })).toBe(false)
    expect(log.info).not.toHaveBeenCalled()
  })
})
