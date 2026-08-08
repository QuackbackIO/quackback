/**
 * Redis keys built from identifiers that only mean something inside one
 * workspace: rate-limit buckets, per-user device sets, presence sorted sets.
 *
 * These are the ones that survive a restart, so an unnamespaced key is not a
 * stale read that clears itself — it is a shared counter, a suppressed
 * new-device alert, and an agent-presence set that routes one workspace's
 * conversations to another workspace's principal ids.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  commands: [] as Array<[string, ...unknown[]]>,
}))

function record(name: string) {
  return (...args: unknown[]) => {
    hoisted.commands.push([name, ...args])
    return Promise.resolve(0)
  }
}

const pipeline = {
  incr: record('incr'),
  expire: record('expire'),
  sadd: record('sadd'),
  exec: async () => [[null, 1]],
}

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    multi: () => pipeline,
    ttl: record('ttl'),
    expire: record('expire'),
    srem: record('srem'),
    zadd: record('zadd'),
    zcard: record('zcard'),
    zrange: async (...args: unknown[]) => {
      hoisted.commands.push(['zrange', ...args])
      return []
    },
    zremrangebyscore: record('zremrangebyscore'),
    eval: record('eval'),
  }),
}))

vi.mock('@/lib/server/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  principal: { id: 'id', chatAvailability: 'chat_availability' },
  eq: () => null,
  and: () => null,
  inArray: () => null,
}))

const { incrementBucket, bucketRetryAfter } = await import('../utils/redis-rate-bucket')
const { isDeviceUnseen, forgetDevice } = await import('../auth/signin-device-tracker')
const { markPresent, clearPresence, listOnlineAgentIds } = await import('../realtime/presence')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

/** Every key argument this suite's commands touched, in order. */
function keys(): string[] {
  return hoisted.commands.map((c) => String(c[1]))
}

beforeEach(() => {
  hoisted.commands.length = 0
})

describe('rate-limit buckets', () => {
  it('namespaces the bucket key by tenant', async () => {
    await withTenant('tenant-alpha', () =>
      incrementBucket({ key: 'signin:ip:203.0.113.4', windowSeconds: 60 })
    )

    expect(keys()).toEqual([
      't:tenant-alpha:signin:ip:203.0.113.4',
      't:tenant-alpha:signin:ip:203.0.113.4',
    ])
  })

  it('gives two tenants separate buckets for the same identifier', async () => {
    const spec = { key: 'signin:ip:203.0.113.4', windowSeconds: 60 }
    await withTenant('tenant-alpha', () => incrementBucket(spec))
    hoisted.commands.length = 0
    await withTenant('tenant-bravo', () => incrementBucket(spec))

    expect(keys()[0]).toBe('t:tenant-bravo:signin:ip:203.0.113.4')
  })

  it('reads the TTL of the same namespaced key it incremented', async () => {
    await withTenant('tenant-alpha', () =>
      bucketRetryAfter({ key: 'signin:ip:203.0.113.4', windowSeconds: 60 })
    )

    expect(keys()).toEqual(['t:tenant-alpha:signin:ip:203.0.113.4'])
  })
})

describe('device tracker', () => {
  it('namespaces the per-user device set', async () => {
    await withTenant('tenant-alpha', () => isDeviceUnseen('user_abc', 'fp1'))

    expect(keys()).toEqual([
      't:tenant-alpha:user:devices:user_abc',
      't:tenant-alpha:user:devices:user_abc',
    ])
  })

  it('rolls back the same namespaced key it claimed', async () => {
    await withTenant('tenant-bravo', () => forgetDevice('user_abc', 'fp1'))

    expect(keys()).toEqual(['t:tenant-bravo:user:devices:user_abc'])
  })
})

describe('presence', () => {
  it('namespaces both the per-principal stream set and the shared agents set', async () => {
    await withTenant('tenant-alpha', () => markPresent('principal_x' as never, 'stream1', true))

    expect(keys()).toEqual([
      't:tenant-alpha:conversation:presence:streams:principal_x',
      't:tenant-alpha:conversation:presence:streams:principal_x',
      't:tenant-alpha:conversation:presence:agents',
    ])
  })

  it('passes namespaced KEYS to the teardown script', async () => {
    await withTenant('tenant-alpha', () => clearPresence('principal_x' as never, 'stream1', true))

    const [command] = hoisted.commands
    expect(command?.[0]).toBe('eval')
    // eval(script, numKeys, KEYS[1], KEYS[2], …)
    expect(command?.[3]).toBe('t:tenant-alpha:conversation:presence:streams:principal_x')
    expect(command?.[4]).toBe('t:tenant-alpha:conversation:presence:agents')
  })

  it('reads a different agents set per tenant', async () => {
    await withTenant('tenant-alpha', () => listOnlineAgentIds())
    await withTenant('tenant-bravo', () => listOnlineAgentIds())

    expect(keys()).toEqual([
      't:tenant-alpha:conversation:presence:agents',
      't:tenant-alpha:conversation:presence:agents',
      't:tenant-bravo:conversation:presence:agents',
      't:tenant-bravo:conversation:presence:agents',
    ])
  })
})
