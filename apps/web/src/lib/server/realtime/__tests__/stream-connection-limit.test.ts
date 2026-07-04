/**
 * The SSE connection limiter (Phase 6 R1) is a concurrency gauge, not a rate
 * limit: it bounds how many streams are open AT ONCE, globally and per-IP, so
 * one client can't monopolize the file-descriptor pool. These tests pin the
 * policy on a fresh instance so they don't touch the process-wide singleton.
 */
import { describe, it, expect } from 'vitest'
import { createStreamLimiter } from '../stream-connection-limit'

describe('createStreamLimiter', () => {
  it('grants slots under both caps', () => {
    const lim = createStreamLimiter({ maxGlobal: 10, maxPerIp: 3 })
    expect(lim.acquire('1.1.1.1').ok).toBe(true)
    expect(lim.acquire('1.1.1.1').ok).toBe(true)
    expect(lim.openCount).toBe(2)
  })

  it('refuses a client over the per-IP cap while other IPs keep connecting', () => {
    const lim = createStreamLimiter({ maxGlobal: 100, maxPerIp: 2 })
    expect(lim.acquire('1.1.1.1').ok).toBe(true)
    expect(lim.acquire('1.1.1.1').ok).toBe(true)
    expect(lim.acquire('1.1.1.1').ok).toBe(false) // 3rd from the same IP
    expect(lim.acquire('2.2.2.2').ok).toBe(true) // a different client is unaffected
  })

  it('refuses when the global cap is hit even if the per-IP dimension has room', () => {
    const lim = createStreamLimiter({ maxGlobal: 2, maxPerIp: 100 })
    expect(lim.acquire('a').ok).toBe(true)
    expect(lim.acquire('b').ok).toBe(true)
    expect(lim.acquire('c').ok).toBe(false) // global full
  })

  it('releasing frees the slot for both caps', () => {
    const lim = createStreamLimiter({ maxGlobal: 1, maxPerIp: 1 })
    const slot = lim.acquire('x')
    expect(slot.ok).toBe(true)
    expect(lim.acquire('x').ok).toBe(false)
    slot.release()
    expect(lim.acquire('x').ok).toBe(true)
  })

  it('release is idempotent — a double release cannot over-credit the caps', () => {
    const lim = createStreamLimiter({ maxGlobal: 2, maxPerIp: 2 })
    const slot = lim.acquire('x')
    slot.release()
    slot.release() // no-op; must not free a second phantom slot
    expect(lim.acquire('x').ok).toBe(true)
    expect(lim.acquire('x').ok).toBe(true)
    expect(lim.acquire('x').ok).toBe(false)
  })

  it('a refused acquire carries a no-op release that cannot corrupt live counts', () => {
    const lim = createStreamLimiter({ maxGlobal: 1, maxPerIp: 1 })
    const held = lim.acquire('x')
    const refused = lim.acquire('x')
    expect(refused.ok).toBe(false)
    refused.release() // must not credit the still-held slot
    expect(lim.acquire('x').ok).toBe(false)
    held.release()
    expect(lim.acquire('x').ok).toBe(true)
  })

  it('drops the per-IP entry at zero so keys do not leak', () => {
    const lim = createStreamLimiter({ maxGlobal: 10, maxPerIp: 5 })
    lim.acquire('gone').release()
    expect(lim.ipCount).toBe(0)
  })

  it('skips the per-IP dimension when the client is unidentifiable (still bounded globally)', () => {
    // getClientIp returns no address behind an unproxied self-host; a per-IP
    // cap on an unresolvable client would false-positive real visitors, so an
    // undefined key falls back to the global cap only.
    const lim = createStreamLimiter({ maxGlobal: 3, maxPerIp: 1 })
    expect(lim.acquire(undefined).ok).toBe(true)
    expect(lim.acquire(undefined).ok).toBe(true) // NOT capped at maxPerIp=1
    expect(lim.acquire(undefined).ok).toBe(true)
    expect(lim.acquire(undefined).ok).toBe(false) // but the global cap still holds
    expect(lim.ipCount).toBe(0) // no key tracked for anonymous clients
  })
})
