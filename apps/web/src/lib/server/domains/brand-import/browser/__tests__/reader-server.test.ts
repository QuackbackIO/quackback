import { describe, expect, it, vi } from 'vitest'
import type { PageRead } from '../read-page'
import { authorised, handleReaderRequest, readQueue } from '../reader-server'

const token = 'a-long-enough-token'

describe('authorised', () => {
  it('accepts the service token as a bearer token and nothing else', () => {
    expect(authorised(`Bearer ${token}`, token)).toBe(true)
    expect(authorised(`Bearer ${token}x`, token)).toBe(false)
    expect(authorised(token, token)).toBe(false)
    expect(authorised(null, token)).toBe(false)
  })
})

describe('readQueue', () => {
  it('runs one read at a time and refuses more than two waiting', async () => {
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
    const accepted = [1, 2].map((n) => enqueue(`https://example.com/${n}`))
    expect(accepted.every(Boolean)).toBe(true)
    expect(enqueue('https://example.com/3')).toBeNull()
    for (let n = 0; n < 2; n++) {
      while (!release.length) await new Promise((done) => setTimeout(done, 1))
      release.shift()!()
    }
    await Promise.all(accepted)
    expect(most).toBe(1)
    expect(enqueue('https://example.com/4')).not.toBeNull()
  })
})

describe('handleReaderRequest', () => {
  const read: PageRead = {
    ok: true,
    url: 'https://acme.example/',
    measure: {
      title: 'Acme',
      themeColor: null,
      bg: 'rgb(255, 255, 255)',
      text: 'rgb(0, 0, 0)',
      bodyFont: 'Lato',
      h1: null,
      buttons: [],
      logo: null,
    },
  }
  const post = (body: unknown, auth = `Bearer ${token}`) =>
    new Request('http://reader:3200/read', {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('answers health checks without a token', async () => {
    const res = await handleReaderRequest(new Request('http://reader:3200/health'), {
      token,
      enqueue: vi.fn(),
    })
    expect(res.status).toBe(200)
  })

  it('refuses a caller without the token', async () => {
    const enqueue = vi.fn()
    const res = await handleReaderRequest(post({ url: 'acme.example' }, 'Bearer nope'), {
      token,
      enqueue,
    })
    expect(res.status).toBe(401)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each([
    'http://127.0.0.1/',
    'https://localhost/',
    'https://acme.example:8443/',
    'ftp://acme.example/',
    'not a site',
  ])('refuses %s before opening a page', async (url) => {
    const enqueue = vi.fn()
    const res = await handleReaderRequest(post({ url }), { token, enqueue })
    expect(res.status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reads a public website and returns the measurements', async () => {
    const enqueue = vi.fn(async () => read)
    const res = await handleReaderRequest(post({ url: 'acme.example' }), { token, enqueue })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(read)
    expect(enqueue).toHaveBeenCalledWith('https://acme.example/')
  })

  it('says busy with a 503 when the queue is full, so the caller retries once', async () => {
    const res = await handleReaderRequest(post({ url: 'acme.example' }), {
      token,
      enqueue: () => null,
    })
    expect(res.status).toBe(503)
  })
})
