/**
 * The real-time bus has no authorization layer of its own: whatever reaches a
 * channel is written straight to every SSE stream subscribed to it. So the
 * workspace boundary IS the delivery decision. `conversation:inbox` is one literal
 * shared by every agent inbox in the process — get this wrong and one
 * workspace's messages stream into another's inbox.
 *
 * This file used to assert the `t:<workspaceKey>:` prefix on the channel name handed
 * to Redis. There is no Redis and no per-channel subscription now, so it asserts
 * the property that replaced it: **every envelope names its publishing workspace,
 * and a subscriber refuses one that disagrees with its own connection.**
 *
 * End-to-end delivery, the connection lifecycle and the two-workspace case all live
 * in `pubsub.db.test.ts` against a real `LISTEN`/`NOTIFY`. What is here is the
 * refusal itself, driven directly, because a database test cannot easily produce
 * a foreign envelope on a workspace's own connection — that is the configuration
 * the refusal exists for and which is not supposed to occur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  notified: [] as string[],
  /** The `onPayload` the production code handed to the listener factory. */
  deliver: null as ((raw: string) => void) | null,
  overflow: new Map<string, unknown>(),
  opens: 0,
}))

vi.mock('../pg-listener', () => ({
  REALTIME_CHANNEL: 'quackback_realtime',
  openRealtimeListener: async (input: { onPayload: (raw: string) => void }) => {
    hoisted.opens += 1
    hoisted.deliver = input.onPayload
    return {
      fetchOverflow: async (_t: string, id: string) => hoisted.overflow.get(id) ?? null,
      close: async () => {},
      verify: async () => true,
    }
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    execute: async (query: unknown) => {
      // Capture the NOTIFY payload without reimplementing the statement. The
      // envelope is the only parameter the publish path passes that is a JSON
      // object with a `t` field, so it is found by walking the built query
      // rather than by assuming drizzle's internal chunk layout.
      const seen = new Set<unknown>()
      const walk = (node: unknown) => {
        if (node === null || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        for (const value of Object.values(node as Record<string, unknown>)) {
          if (typeof value === 'string' && value.startsWith('{"t":')) hoisted.notified.push(value)
          else walk(value)
        }
      }
      walk(query)
      return []
    },
  },
}))

vi.mock('../../workspaces/mode', () => ({ isPooledTenancy: () => false }))
vi.mock('../../config', () => ({ config: { databaseUrl: 'postgresql://x/y' } }))

const { subscribe, publishAsync, closeSubscriber, openListenerCount } = await import('../pubsub')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

beforeEach(() => {
  hoisted.notified = []
  hoisted.deliver = null
  hoisted.overflow.clear()
  hoisted.opens = 0
})

afterEach(async () => {
  await closeSubscriber()
})

describe('the envelope names its publishing workspace', () => {
  it('publish stamps the active workspace, not the channel name', async () => {
    await withWorkspace('workspace-alpha', () => publishAsync('conversation:inbox', { n: 1 }))
    expect(hoisted.notified).toHaveLength(1)
    const envelope = JSON.parse(hoisted.notified[0])
    expect(envelope.t).toBe('workspace-alpha')
    expect(envelope.c).toBe('conversation:inbox')
    expect(envelope.p).toEqual({ n: 1 })
  })

  it('and `_` with no workspace scope — one stable namespace, never absent', async () => {
    await publishAsync('conversation:inbox', { n: 2 })
    expect(JSON.parse(hoisted.notified[0]).t).toBe('_')
  })
})

describe('a subscriber refuses an envelope from another workspace', () => {
  it("delivers its own workspace's message and drops the foreign one", async () => {
    const seen: string[] = []
    const off = await withWorkspace('workspace-alpha', () =>
      subscribe(['conversation:inbox'], (_c, m) => seen.push(m))
    )
    expect(hoisted.deliver).toBeTruthy()

    // A message published under bravo, arriving on alpha's connection. This is
    // the shape a shared database or a mis-resolved pool produces.
    hoisted.deliver!(
      JSON.stringify({ t: 'workspace-bravo', c: 'conversation:inbox', p: { secret: 1 } })
    )
    // The positive control: without it, "nothing arrived" is also what a dead
    // dispatcher looks like.
    hoisted.deliver!(
      JSON.stringify({ t: 'workspace-alpha', c: 'conversation:inbox', p: { mine: 1 } })
    )

    expect(seen.map((m) => JSON.parse(m))).toEqual([{ mine: 1 }])
    await off()
  })

  it('refuses a foreign overflow envelope without ever fetching the row', async () => {
    hoisted.overflow.set('99', { secret: 'bravo body' })
    const seen: string[] = []
    const off = await withWorkspace('workspace-alpha', () =>
      subscribe(['big'], (_c, m) => seen.push(m))
    )

    hoisted.deliver!(JSON.stringify({ t: 'workspace-bravo', c: 'big', o: '99' }))
    hoisted.overflow.set('100', { mine: true })
    hoisted.deliver!(JSON.stringify({ t: 'workspace-alpha', c: 'big', o: '100' }))
    await new Promise((r) => setTimeout(r, 20))

    expect(seen.map((m) => JSON.parse(m))).toEqual([{ mine: true }])
    await off()
  })

  it('two workspaces subscribed to the same channel name do not share a handler set', async () => {
    const alpha: string[] = []
    const bravo: string[] = []
    const offA = await withWorkspace('workspace-alpha', () =>
      subscribe(['conversation:inbox'], (_c, m) => alpha.push(m))
    )
    const deliverAlpha = hoisted.deliver!
    const offB = await withWorkspace('workspace-bravo', () =>
      subscribe(['conversation:inbox'], (_c, m) => bravo.push(m))
    )
    const deliverBravo = hoisted.deliver!

    deliverAlpha(JSON.stringify({ t: 'workspace-alpha', c: 'conversation:inbox', p: 'a' }))
    deliverBravo(JSON.stringify({ t: 'workspace-bravo', c: 'conversation:inbox', p: 'b' }))

    expect(alpha.map((m) => JSON.parse(m))).toEqual(['a'])
    expect(bravo.map((m) => JSON.parse(m))).toEqual(['b'])
    await offA()
    await offB()
  })
})

describe('a subscribe with no channels', () => {
  it('does not open a LISTEN — presence-only streams have nothing to hear', async () => {
    await closeSubscriber()
    const off = await withWorkspace('workspace-alpha', () => subscribe([], () => {}))
    expect(hoisted.opens).toBe(0)
    expect(openListenerCount()).toBe(0)
    await off()
    expect(openListenerCount()).toBe(0)
  })
})
