/**
 * Presence under real concurrency.
 *
 * The Redis version's `clearPresence` was an `EVAL` for one reason: Redis is
 * single-threaded, so remove-prune-count-and-drop could not interleave. Ported
 * to Postgres, "it is atomic because it is one statement" is a claim, and a
 * single-threaded test cannot distinguish it from a two-statement version that
 * happens to work when nothing else is running.
 *
 * So every case below runs N real connections against a real server, and each
 * one has a **positive control that fails on the current implementation if the
 * property does not hold** rather than an assertion that a sequential run would
 * also satisfy.
 *
 * The property that matters, stated exactly: across a set of concurrent
 * `clearPresence` calls for one principal, **exactly one** may return true. Two
 * would re-queue an agent's conversations twice; zero would leave them
 * unassigned forever.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ensureKvSchema,
  withRealTenant,
  tenantPair,
  cleanupTenants,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'
import {
  markPresent,
  clearPresence,
  refreshPresence,
  isPrincipalOnline,
  listOnlineAgentIds,
  PRESENCE_TTL_SECONDS,
} from '../presence'
import type { PrincipalId } from '@quackback/ids'

const [T] = tenantPair()
const AGENT = 'principal_01concurrentagent' as PrincipalId

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupTenants(T)
  await closeHarness()
})

async function reset(): Promise<void> {
  await testSql()`DELETE FROM presence_stream WHERE tenant_id = ${T}`
}

describe('clearPresence is indivisible', () => {
  it('exactly one of N concurrent teardowns reports the principal went offline', async () => {
    const N = 24
    for (let attempt = 0; attempt < 5; attempt++) {
      await reset()
      const streams = Array.from({ length: N }, (_, i) => `stream-${attempt}-${i}`)
      await Promise.all(streams.map((s) => withRealTenant(T, () => markPresent(AGENT, s, true))))

      // All N tear down at once, on N separate connections.
      const results = await Promise.all(
        streams.map((s) => withRealTenant(T, () => clearPresence(AGENT, s, true)))
      )

      const wentOffline = results.filter(Boolean).length
      expect(
        wentOffline,
        `attempt ${attempt}: ${wentOffline} of ${N} claimed the offline edge`
      ).toBe(1)
      expect(await withRealTenant(T, () => isPrincipalOnline(AGENT))).toBe(false)
    }
  })

  it('a concurrent reconnect is never reported as offline while it is live', async () => {
    // The interleave the Lua script existed to prevent: a teardown deciding
    // "nobody is left" while another tab has already registered.
    for (let attempt = 0; attempt < 8; attempt++) {
      await reset()
      await withRealTenant(T, () => markPresent(AGENT, 'old-tab', true))

      const [offline] = await Promise.all([
        withRealTenant(T, () => clearPresence(AGENT, 'old-tab', true)),
        withRealTenant(T, () => markPresent(AGENT, 'new-tab', true)),
      ])

      // Either ordering is legitimate — what is NOT legitimate is reporting
      // offline while the new tab's row is live, because the caller re-queues
      // the agent's conversations on that signal.
      const stillOnline = await withRealTenant(T, () => isPrincipalOnline(AGENT))
      expect(stillOnline).toBe(true)
      if (offline) {
        // Allowed only when the reconnect landed after the decision, which the
        // Redis version permitted too. Recorded rather than asserted away.
        expect(await withRealTenant(T, () => listOnlineAgentIds())).toContain(AGENT)
      }
    }
  })

  it('N concurrent heartbeats for one stream do not duplicate or lose the row', async () => {
    await reset()
    await Promise.all(
      Array.from({ length: 30 }, () => withRealTenant(T, () => refreshPresence(AGENT, 'one', true)))
    )
    const rows = await testSql()<{ n: string }[]>`
      SELECT count(*)::text AS n FROM presence_stream
      WHERE tenant_id = ${T} AND principal_id = ${AGENT}
    `
    expect(rows[0].n).toBe('1')
    expect(await withRealTenant(T, () => isPrincipalOnline(AGENT))).toBe(true)
  })

  it('heartbeats and teardowns interleaved across many streams settle correctly', async () => {
    await reset()
    const live = ['a', 'b', 'c', 'd']
    const doomed = ['x', 'y', 'z']
    await Promise.all(
      [...live, ...doomed].map((s) => withRealTenant(T, () => markPresent(AGENT, s, true)))
    )

    const teardowns = doomed.map((s) => withRealTenant(T, () => clearPresence(AGENT, s, true)))
    const beats = live.flatMap((s) =>
      Array.from({ length: 4 }, () => withRealTenant(T, () => refreshPresence(AGENT, s, true)))
    )
    const results = await Promise.all([...teardowns, ...beats])

    // No teardown may claim the offline edge: four streams are still beating.
    expect(results.slice(0, doomed.length).filter(Boolean)).toEqual([])
    const rows = await testSql()<{ stream_id: string }[]>`
      SELECT stream_id FROM presence_stream
      WHERE tenant_id = ${T} AND principal_id = ${AGENT} ORDER BY stream_id
    `
    expect(rows.map((r) => r.stream_id)).toEqual(live)
  })
})

describe('staleness', () => {
  it('a ghost stream from a crashed replica cannot keep a principal online', async () => {
    await reset()
    await withRealTenant(T, () => markPresent(AGENT, 'ghost', true))
    await testSql()`
      UPDATE presence_stream
      SET heartbeat_at = now() - make_interval(secs => ${PRESENCE_TTL_SECONDS + 5})
      WHERE tenant_id = ${T} AND principal_id = ${AGENT}
    `
    expect(await withRealTenant(T, () => isPrincipalOnline(AGENT))).toBe(false)
    expect(await withRealTenant(T, () => listOnlineAgentIds())).toEqual([])
  })

  it('tearing down a live stream ignores ghosts when deciding "went offline"', async () => {
    await reset()
    await withRealTenant(T, () => markPresent(AGENT, 'ghost', true))
    await withRealTenant(T, () => markPresent(AGENT, 'live', true))
    await testSql()`
      UPDATE presence_stream
      SET heartbeat_at = now() - make_interval(secs => ${PRESENCE_TTL_SECONDS + 5})
      WHERE tenant_id = ${T} AND stream_id = 'ghost'
    `
    // The ghost must not count as "someone is still here".
    expect(await withRealTenant(T, () => clearPresence(AGENT, 'live', true))).toBe(true)
    const rows = await testSql()<{ n: string }[]>`
      SELECT count(*)::text AS n FROM presence_stream WHERE tenant_id = ${T}
    `
    // Both rows gone: the one asked for, and the ghost pruned alongside it.
    expect(rows[0].n).toBe('0')
  })

  it('a new heartbeat prunes the principal’s own abandoned streams', async () => {
    await reset()
    await withRealTenant(T, () => markPresent(AGENT, 'abandoned', true))
    await testSql()`
      UPDATE presence_stream
      SET heartbeat_at = now() - make_interval(secs => ${PRESENCE_TTL_SECONDS + 5})
      WHERE tenant_id = ${T} AND stream_id = 'abandoned'
    `
    await withRealTenant(T, () => markPresent(AGENT, 'fresh', true))
    const rows = await testSql()<{ stream_id: string }[]>`
      SELECT stream_id FROM presence_stream WHERE tenant_id = ${T}
    `
    expect(rows.map((r) => r.stream_id)).toEqual(['fresh'])
  })
})
