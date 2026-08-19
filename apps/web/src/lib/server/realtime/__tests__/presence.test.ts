import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal in-memory Redis sorted-set fake — enough to exercise the per-principal
// stream-set presence logic realistically (incl. cross-replica + crash pruning).
const store = new Map<string, Map<string, number>>()
const set = (key: string) => {
  let z = store.get(key)
  if (!z) store.set(key, (z = new Map()))
  return z
}
const fakeRedis = {
  zadd: vi.fn(async (key: string, score: number, member: string) => {
    set(key).set(member, score)
  }),
  zrem: vi.fn(async (key: string, member: string) => {
    const z = store.get(key)
    if (z) {
      z.delete(member)
      if (z.size === 0) store.delete(key) // Redis drops empty sorted sets
    }
  }),
  zremrangebyscore: vi.fn(async (key: string, min: number, max: number) => {
    const z = store.get(key)
    if (!z) return
    for (const [m, s] of z) if (s >= min && s <= max) z.delete(m)
    if (z.size === 0) store.delete(key)
  }),
  zcard: vi.fn(async (key: string) => store.get(key)?.size ?? 0),
  zrange: vi.fn(async (key: string) => [...(store.get(key)?.keys() ?? [])]),
  expire: vi.fn(async () => {}),
  // Mirrors CLEAR_PRESENCE_SCRIPT (the only eval) against the in-memory store.
  eval: vi.fn(async (_script: string, numKeys: number, ...args: string[]) => {
    const [streamsK, agentsK] = args.slice(0, numKeys)
    const [streamId, cutoff, principalId, isAgent] = args.slice(numKeys)
    await fakeRedis.zrem(streamsK, streamId)
    await fakeRedis.zremrangebyscore(streamsK, 0, Number(cutoff))
    if ((await fakeRedis.zcard(streamsK)) > 0) return 0
    if (isAgent === '1') await fakeRedis.zrem(agentsK, principalId)
    return 1
  }),
}
vi.mock('../../redis', () => ({ getRedis: () => fakeRedis }))

import {
  markPresent,
  refreshPresence,
  clearPresence,
  isPrincipalOnline,
  isAnyAgentOnline,
  PRESENCE_TTL_SECONDS,
} from '../presence'
import type { PrincipalId } from '@quackback/ids'

const A = 'principal_a' as unknown as PrincipalId

describe('presence (per-principal stream set)', () => {
  beforeEach(() => store.clear())

  it('marks a principal online for the lifetime of a stream', async () => {
    expect(await isPrincipalOnline(A)).toBe(false)
    await markPresent(A, 'stream-1', false)
    expect(await isPrincipalOnline(A)).toBe(true)
    expect(await clearPresence(A, 'stream-1', false)).toBe(true) // last stream → offline
    expect(await isPrincipalOnline(A)).toBe(false)
  })

  it('stays online (and reports not-offline) until the LAST stream closes', async () => {
    // Two concurrent streams (e.g. two replicas / tabs) for the same principal.
    await markPresent(A, 'stream-1', true)
    await markPresent(A, 'stream-2', true)
    // Closing the first is NOT "went offline" — the other is still live.
    expect(await clearPresence(A, 'stream-1', true)).toBe(false)
    expect(await isPrincipalOnline(A)).toBe(true)
    expect(await isAnyAgentOnline()).toBe(true)
    // Closing the last one is.
    expect(await clearPresence(A, 'stream-2', true)).toBe(true)
    expect(await isPrincipalOnline(A)).toBe(false)
    expect(await isAnyAgentOnline()).toBe(false)
  })

  it('prunes a crashed replica’s stale stream so it cannot keep a principal online', async () => {
    // A ghost stream whose last heartbeat is older than the TTL.
    set(`conversation:presence:streams:${A}`).set(
      'ghost',
      Date.now() - (PRESENCE_TTL_SECONDS + 5) * 1000
    )
    expect(await isPrincipalOnline(A)).toBe(false) // stale member pruned on read
  })

  it('does not report a clean offline when Redis throws', async () => {
    await markPresent(A, 'stream-1', true)
    fakeRedis.eval.mockRejectedValueOnce(new Error('redis down'))
    expect(await clearPresence(A, 'stream-1', true)).toBe(false)
  })

  it('refreshPresence keeps the stream live without adding a duplicate', async () => {
    await markPresent(A, 'stream-1', false)
    await refreshPresence(A, 'stream-1', false)
    expect(await isPrincipalOnline(A)).toBe(true)
    expect(store.get(`conversation:presence:streams:${A}`)?.size).toBe(1)
  })
})
