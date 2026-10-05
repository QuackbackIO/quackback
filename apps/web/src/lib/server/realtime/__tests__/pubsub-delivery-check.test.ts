/**
 * Behind a transaction-mode pooler, `LISTEN` is accepted and nothing is ever
 * delivered, so realtime goes quiet with no signal. After the listener first
 * connects, a notify round trip checks delivery and logs an error naming the
 * cause when it fails. A failed check never breaks subscribing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  errors: [] as Array<{ obj: unknown; msg: string }>,
  warns: [] as Array<{ obj: unknown; msg: string }>,
  /** Whether the double's NOTIFY round trip reaches `onPayload`. */
  delivers: true,
  verifyCalls: 0,
  throws: false,
  pooled: false,
  opens: 0,
}))

vi.mock('@/lib/server/logger', () => {
  const log = {
    error: (obj: unknown, msg: string) => hoisted.errors.push({ obj, msg }),
    warn: (obj: unknown, msg: string) => hoisted.warns.push({ obj, msg }),
    info: () => {},
    debug: () => {},
    child: () => log,
  }
  return { logger: log }
})

// A listener that really waits for a probe to arrive through `onPayload`, the
// same path a NOTIFY takes. A pooled connection never calls it.
vi.mock('../pg-listener', () => ({
  REALTIME_CHANNEL: 'quackback_realtime',
  openRealtimeListener: async (input: { onPayload: (raw: string) => void }) => {
    hoisted.opens += 1
    return {
      fetchOverflow: async () => null,
      close: async () => {},
      verify: async () => {
        hoisted.verifyCalls += 1
        if (hoisted.throws) throw new Error('sender connection refused')
        return await new Promise<boolean>((resolve) => {
          if (hoisted.delivers) {
            input.onPayload('__verify__probe')
            resolve(true)
          } else {
            setTimeout(() => resolve(false), 5)
          }
        })
      },
    }
  },
}))

vi.mock('@/lib/server/db', () => ({ db: { execute: async () => [] } }))
vi.mock('../../workspaces/mode', () => ({ isPooledTenancy: () => hoisted.pooled }))
vi.mock('../../config', () => ({ config: { databaseUrl: 'postgresql://x/y' } }))

const { subscribe, closeSubscriber } = await import('../pubsub')

const flush = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  hoisted.errors = []
  hoisted.warns = []
  hoisted.delivers = true
  hoisted.verifyCalls = 0
  hoisted.throws = false
  hoisted.pooled = false
  hoisted.opens = 0
})
afterEach(async () => {
  await closeSubscriber()
})

describe('realtime delivery check', () => {
  it('logs an error naming DATABASE_URL when notifications are not delivered', async () => {
    hoisted.delivers = false
    const unsubscribe = await subscribe(['conversation:inbox'], () => {})
    await flush()

    expect(hoisted.verifyCalls).toBe(1)
    expect(hoisted.errors).toHaveLength(1)
    expect(hoisted.errors[0].msg).toMatch(/DATABASE_URL/)
    expect(hoisted.errors[0].msg).toMatch(/LISTEN\/NOTIFY/)
    expect(hoisted.errors[0].msg).toMatch(/session-mode|direct/)
    await unsubscribe()
  })

  it('stays quiet when notifications are delivered', async () => {
    const unsubscribe = await subscribe(['conversation:inbox'], () => {})
    await flush()

    expect(hoisted.verifyCalls).toBe(1)
    expect(hoisted.errors).toHaveLength(0)
    await unsubscribe()
  })

  it('checks once per connection, not once per subscribe', async () => {
    const a = await subscribe(['conversation:inbox'], () => {})
    const b = await subscribe(['conversation:other'], () => {})
    await flush()

    expect(hoisted.opens).toBe(1)
    expect(hoisted.verifyCalls).toBe(1)
    await a()
    await b()
  })

  it('warns, without the pooler diagnosis, when the probe could not run', async () => {
    hoisted.throws = true
    const unsubscribe = await subscribe(['conversation:inbox'], () => {})
    await flush()
    expect(unsubscribe).toBeTypeOf('function')
    expect(hoisted.errors).toHaveLength(0)
    expect(hoisted.warns).toHaveLength(1)
    expect(hoisted.warns[0].msg).toBe('realtime delivery check could not run')
    expect((hoisted.warns[0].obj as { err: Error }).err.message).toMatch(/refused/)
    await unsubscribe()
  })

  it('names the workspace direct URL, never DATABASE_URL or the URL itself, under pooled tenancy', async () => {
    hoisted.delivers = false
    hoisted.pooled = true
    const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')
    const unsubscribe = await withWorkspace('workspace-alpha', () =>
      subscribe(['conversation:inbox'], () => {})
    )
    await flush()

    expect(hoisted.errors).toHaveLength(1)
    const msg = hoisted.errors[0].msg
    expect(msg).toContain('workspace-alpha')
    expect(msg).toMatch(/direct database URL/)
    expect(msg).not.toMatch(/DATABASE_URL/)
    expect(msg).not.toContain('db.example.com')
    await unsubscribe()
  })
})
