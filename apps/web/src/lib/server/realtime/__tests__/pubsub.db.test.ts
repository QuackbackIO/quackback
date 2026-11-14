/**
 * The realtime bus, end to end over a real `LISTEN`/`NOTIFY`.
 *
 * §7.3's lesson, applied: a `LISTEN` is only ever verified by round-tripping a
 * real NOTIFY. `pg_listening_channels()` reports the registration as held on a
 * connection that delivers nothing, so every case here waits for a message to
 * actually arrive rather than asking whether anything is registered.
 *
 * The publish side runs through the production `publishAsync` and the subscribe
 * side through the production `subscribe` — including the real
 * `openRealtimeListener` connection — so a change to the envelope, the channel
 * name, or the overflow threshold is observable here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// `directConnection()` reads config.databaseUrl in single-workspace mode. The real
// config schema needs these to load at all; this is the same DSN vitest.config
// already points every suite at.
vi.stubEnv(
  'DATABASE_URL',
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
)
vi.stubEnv('BASE_URL', 'http://localhost:3000')
vi.stubEnv('SECRET_KEY', 'test-secret-key-0123456789abcdef0123456789abcdef')

import {
  ensureKvSchema,
  withRealWorkspace,
  workspacePair,
  cleanupWorkspaces,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'
import { subscribe, publishAsync, closeSubscriber, openListenerCount } from '../pubsub'

const [T, OTHER] = workspacePair()

/** Wait for a condition, or fail loudly rather than silently timing out green. */
async function until(predicate: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out waiting for a NOTIFY that never arrived')
}

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await closeSubscriber()
  await cleanupWorkspaces(T, OTHER)
  await closeHarness()
})

describe('publish → subscribe', () => {
  it('delivers a payload to a subscriber on the logical channel it asked for', async () => {
    const seen: Array<[string, string]> = []
    const off = await withRealWorkspace(T, () =>
      subscribe(['conversation:inbox'], (c, m) => seen.push([c, m]))
    )
    try {
      await withRealWorkspace(T, () =>
        publishAsync('conversation:inbox', { kind: 'message', id: 7 })
      )
      await until(() => seen.length > 0)
      expect(seen[0][0]).toBe('conversation:inbox')
      expect(JSON.parse(seen[0][1])).toEqual({ kind: 'message', id: 7 })
    } finally {
      await off()
    }
  })

  it('does not deliver a channel the subscriber did not ask for', async () => {
    const seen: string[] = []
    const off = await withRealWorkspace(T, () =>
      subscribe(['conversation:inbox'], (_c, m) => seen.push(m))
    )
    try {
      await withRealWorkspace(T, () => publishAsync('conversation:other', { n: 1 }))
      // Publish a second message the subscriber IS listening for, so "nothing
      // arrived" cannot be explained by the bus being broken.
      await withRealWorkspace(T, () => publishAsync('conversation:inbox', { n: 2 }))
      await until(() => seen.length > 0)
      expect(seen.map((m) => JSON.parse(m))).toEqual([{ n: 2 }])
    } finally {
      await off()
    }
  })

  it('carries a payload larger than a NOTIFY can hold', async () => {
    // pg_notify caps at 8000 bytes and a conversation event with a long body can
    // exceed it. Dropping it would be a message the agent never sees.
    const body = 'x'.repeat(40_000)
    const seen: string[] = []
    const off = await withRealWorkspace(T, () => subscribe(['big'], (_c, m) => seen.push(m)))
    try {
      await withRealWorkspace(T, () => publishAsync('big', { body }))
      await until(() => seen.length > 0)
      expect(JSON.parse(seen[0])).toEqual({ body })
      // And it spilled to a row rather than being truncated.
      const rows = await testSql()<{ n: string }[]>`
        SELECT count(*)::text AS n FROM realtime_overflow WHERE workspace_key = ${T}
      `
      expect(rows[0].n).toBe('1')
    } finally {
      await off()
    }
  })

  it('a raw oversized NOTIFY is refused by Postgres — which is why the overflow path exists', async () => {
    // The control for the case above: without the spill, this is what publishing
    // a large event would do.
    await expect(
      testSql()`SELECT pg_notify('quackback_realtime', ${'y'.repeat(9_000)})`
    ).rejects.toThrow(/payload string too long/i)
  })
})

describe('connection lifecycle', () => {
  it('opens one connection for a workspace and closes it when the last subscriber leaves', async () => {
    await closeSubscriber()
    expect(openListenerCount()).toBe(0)

    const offA = await withRealWorkspace(T, () => subscribe(['a'], () => {}))
    const offB = await withRealWorkspace(T, () => subscribe(['b'], () => {}))
    expect(openListenerCount()).toBe(1)

    await offA()
    expect(openListenerCount()).toBe(1)
    await offB()
    expect(openListenerCount()).toBe(0)
  })

  it('two workspaces get two connections, not one shared bus', async () => {
    await closeSubscriber()
    const off1 = await withRealWorkspace(T, () => subscribe(['x'], () => {}))
    const off2 = await withRealWorkspace(OTHER, () => subscribe(['x'], () => {}))
    try {
      expect(openListenerCount()).toBe(2)
    } finally {
      await off1()
      await off2()
    }
  })

  it('a subscriber only receives messages published inside its own workspace scope', async () => {
    await closeSubscriber()
    const mine: string[] = []
    const theirs: string[] = []
    const offMine = await withRealWorkspace(T, () => subscribe(['shared'], (_c, m) => mine.push(m)))
    const offTheirs = await withRealWorkspace(OTHER, () =>
      subscribe(['shared'], (_c, m) => theirs.push(m))
    )
    try {
      await withRealWorkspace(T, () => publishAsync('shared', { from: 'T' }))
      await until(() => mine.length > 0)
      // Give the other side the same wall-clock chance to receive it.
      await new Promise((r) => setTimeout(r, 300))
      expect(mine.map((m) => JSON.parse(m))).toEqual([{ from: 'T' }])
      expect(theirs).toEqual([])

      // And the reverse direction, so this is not an artefact of write order.
      await withRealWorkspace(OTHER, () => publishAsync('shared', { from: 'OTHER' }))
      await until(() => theirs.length > 0)
      await new Promise((r) => setTimeout(r, 300))
      expect(theirs.map((m) => JSON.parse(m))).toEqual([{ from: 'OTHER' }])
      expect(mine.map((m) => JSON.parse(m))).toEqual([{ from: 'T' }])
    } finally {
      await offMine()
      await offTheirs()
    }
  })
})

describe('the inbox scope envelope (`s`)', () => {
  const scope = {
    kind: 'conversation' as const,
    id: 'conversation_1',
    assigneePrincipalId: 'principal_a',
    teamId: null,
  }

  /** Every raw NOTIFY on the realtime channel, as Postgres delivered it. */
  async function rawNotifies(): Promise<{ seen: string[]; stop: () => Promise<void> }> {
    const seen: string[] = []
    const { unlisten } = await testSql().listen('quackback_realtime', (raw) => {
      seen.push(raw)
    })
    return { seen, stop: unlisten }
  }

  it('reaches the handler beside the payload, and never inside it', async () => {
    const seen: Array<[string, unknown]> = []
    const off = await withRealWorkspace(T, () =>
      subscribe(['conversation:inbox'], (_c, m, s) => seen.push([m, s]))
    )
    try {
      await withRealWorkspace(T, () =>
        publishAsync('conversation:inbox', { kind: 'message', id: 1 }, scope)
      )
      await until(() => seen.length > 0)
      expect(JSON.parse(seen[0][0])).toEqual({ kind: 'message', id: 1 })
      expect(seen[0][1]).toEqual(scope)
    } finally {
      await off()
    }
  })

  it('stays inline in the NOTIFY when the payload spills to a row', async () => {
    const body = 'x'.repeat(40_000)
    const seen: Array<[string, unknown]> = []
    const raw = await rawNotifies()
    const off = await withRealWorkspace(T, () =>
      subscribe(['conversation:inbox'], (_c, m, s) => seen.push([m, s]))
    )
    try {
      await withRealWorkspace(T, () => publishAsync('conversation:inbox', { body }, scope))
      await until(() => seen.length > 0)
      expect(JSON.parse(seen[0][0])).toEqual({ body })
      expect(seen[0][1]).toEqual(scope)
      // The raw listener is its own connection and can hear it a moment later.
      await until(() => raw.seen.some((r) => r.includes('"o":')))
      const spilled = raw.seen
        .filter((r) => !r.startsWith('__verify__'))
        .map((r) => JSON.parse(r) as { o?: string; s?: unknown })
        .find((e) => typeof e.o === 'string')
      expect(spilled?.s).toEqual(scope)
      const rows = await testSql()<{ payload: unknown }[]>`
        SELECT payload FROM realtime_overflow WHERE id = ${spilled?.o ?? '0'}
      `
      expect(rows[0].payload).toEqual({ body })
    } finally {
      await off()
      await raw.stop()
    }
  })

  it('is absent from the wire, and from the handler, for a publish without it', async () => {
    const seen: Array<[string, unknown]> = []
    const raw = await rawNotifies()
    const off = await withRealWorkspace(T, () =>
      subscribe(['conversation:visitor-1'], (_c, m, s) => seen.push([m, s]))
    )
    try {
      await withRealWorkspace(T, () => publishAsync('conversation:visitor-1', { n: 1 }))
      await until(() => seen.length > 0)
      expect(seen[0][1]).toBeUndefined()
      await until(() => raw.seen.some((r) => r.includes('conversation:visitor-1')))
      const envelopes = raw.seen
        .filter((r) => !r.startsWith('__verify__'))
        .map((r) => JSON.parse(r) as Record<string, unknown>)
        .filter((e) => e.c === 'conversation:visitor-1')
      expect(envelopes).toHaveLength(1)
      expect('s' in envelopes[0]).toBe(false)
    } finally {
      await off()
      await raw.stop()
    }
  })
})
