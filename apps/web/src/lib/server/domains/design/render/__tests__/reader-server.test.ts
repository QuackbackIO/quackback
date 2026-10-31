import { describe, expect, it } from 'vitest'
import type { PageRead } from '../read-page'
import { authorised, readQueue } from '../reader-server'

describe('authorised', () => {
  const token = 'a-long-enough-token'
  it('accepts the service token as a bearer token and nothing else', () => {
    expect(authorised(`Bearer ${token}`, token)).toBe(true)
    expect(authorised(`Bearer ${token}x`, token)).toBe(false)
    expect(authorised(token, token)).toBe(false)
    expect(authorised(null, token)).toBe(false)
  })
})

describe('readQueue', () => {
  it('runs one read at a time and refuses more than four waiting', async () => {
    let running = 0
    let most = 0
    const release: Array<() => void> = []
    const enqueue = readQueue(async () => {
      running++
      most = Math.max(most, running)
      await new Promise<void>((done) => release.push(done))
      running--
      return { ok: false, reason: 'unreachable' } satisfies PageRead
    })
    const accepted = [1, 2, 3, 4].map((n) => enqueue(`https://example.com/${n}`))
    expect(accepted.every(Boolean)).toBe(true)
    expect(enqueue('https://example.com/5')).toBeNull()
    // Each read starts only once the one before it ends.
    for (let n = 0; n < 4; n++) {
      while (!release.length) await new Promise((done) => setTimeout(done, 1))
      release.shift()!()
    }
    await Promise.all(accepted)
    expect(most).toBe(1)
    // Room again once the queue drains.
    expect(enqueue('https://example.com/6')).not.toBeNull()
  })
})
