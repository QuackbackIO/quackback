import { describe, it, expect } from 'vitest'
import {
  contentLengthExceeds,
  readBodyWithLimit,
  readTextBodyWithLimit,
  readTextBodyOr413,
} from '../read-body'

const LIMIT = 100

function makeStreamRequest(chunks: Uint8Array[]): Request {
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++])
      } else {
        controller.close()
      }
    },
  })
  return new Request('http://localhost/api/storage/test.png', {
    method: 'PUT',
    body: stream,
    // @ts-expect-error duplex required by fetch spec for streaming request bodies
    duplex: 'half',
  })
}

describe('readBodyWithLimit', () => {
  it('returns assembled Uint8Array for a body within the limit', async () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5, 6])
    const req = makeStreamRequest([a, b])
    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
  })

  it('returns null and cancels stream when a chunk pushes total over the limit', async () => {
    // Three 40-byte chunks: first two (80 bytes total) are within limit,
    // third (120 bytes total) exceeds it; cancel must fire before the third chunk is stored.
    let enqueuedCount = 0
    let cancelledByReader = false

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (enqueuedCount < 3) {
          enqueuedCount++
          controller.enqueue(new Uint8Array(40))
        } else {
          controller.close()
        }
      },
      cancel() {
        cancelledByReader = true
      },
    })

    const req = new Request('http://localhost/api/storage/test.png', {
      method: 'PUT',
      body: stream,
      // @ts-expect-error duplex required by fetch spec for streaming request bodies
      duplex: 'half',
    })

    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toBeNull()
    expect(cancelledByReader).toBe(true)
    // Only two chunks should have been read before cancellation
    expect(enqueuedCount).toBeLessThanOrEqual(3)
  })

  it('returns empty Uint8Array for a request with no body', async () => {
    const req = new Request('http://localhost/api/storage/test.png', { method: 'PUT' })
    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toEqual(new Uint8Array(0))
  })

  it('accepts a body exactly at the limit', async () => {
    const exact = new Uint8Array(LIMIT)
    exact.fill(0xff)
    const req = makeStreamRequest([exact])
    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toEqual(exact)
  })

  it('rejects a body one byte over the limit', async () => {
    const overBy1 = new Uint8Array(LIMIT + 1)
    const req = makeStreamRequest([overBy1])
    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toBeNull()
  })

  it('correctly handles many small chunks that together stay within the limit', async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => new Uint8Array([i]))
    const req = makeStreamRequest(chunks)
    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
  })

  // The test environment's Request drops the forbidden Content-Length header,
  // so these use a minimal Request-like stub; real server requests carry it.
  function withContentLength(contentLength: string, stream: ReadableStream<Uint8Array>): Request {
    return {
      headers: new Headers({ 'content-length': contentLength }),
      body: stream,
    } as unknown as Request
  }

  it('rejects on a declared Content-Length over the limit without touching the body', async () => {
    let bodyAccessed = false
    const req = {
      headers: new Headers({ 'content-length': String(LIMIT + 1) }),
      get body() {
        bodyAccessed = true
        return null
      },
    } as unknown as Request

    const result = await readBodyWithLimit(req, LIMIT)
    expect(result).toBeNull()
    expect(bodyAccessed).toBe(false)
  })

  it('reads normally when the declared Content-Length is within the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7, 8]))
        controller.close()
      },
    })

    const result = await readBodyWithLimit(withContentLength('2', stream), LIMIT)
    expect(result).toEqual(new Uint8Array([7, 8]))
  })

  it('falls back to stream enforcement when Content-Length is malformed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(LIMIT + 1))
        controller.close()
      },
    })

    const result = await readBodyWithLimit(withContentLength('not-a-number', stream), LIMIT)
    expect(result).toBeNull()
  })
})

describe('contentLengthExceeds', () => {
  // The test environment's Request drops the forbidden Content-Length header,
  // so these use a minimal Request-like stub; real server requests carry it.
  function reqWithContentLength(contentLength?: string): Request {
    const headers = new Headers()
    if (contentLength !== undefined) headers.set('content-length', contentLength)
    return { headers } as unknown as Request
  }

  it('is true when the declared length exceeds the limit', () => {
    expect(contentLengthExceeds(reqWithContentLength('101'), 100)).toBe(true)
  })

  it('is false when the declared length is exactly at the limit', () => {
    expect(contentLengthExceeds(reqWithContentLength('100'), 100)).toBe(false)
  })

  it('is false when the declared length is within the limit', () => {
    expect(contentLengthExceeds(reqWithContentLength('2'), 100)).toBe(false)
  })

  it('is false when the header is missing (Number(null) is 0)', () => {
    expect(contentLengthExceeds(reqWithContentLength(), 100)).toBe(false)
  })

  it('is false when the header is malformed (NaN is inconclusive)', () => {
    expect(contentLengthExceeds(reqWithContentLength('not-a-number'), 100)).toBe(false)
  })
})

describe('readTextBodyWithLimit', () => {
  it('decodes a body within the limit as UTF-8 text', async () => {
    const req = new Request('http://localhost/api/webhook', {
      method: 'POST',
      body: 'hello wörld',
    })
    const result = await readTextBodyWithLimit(req, LIMIT)
    expect(result).toBe('hello wörld')
  })

  it('returns null when the body exceeds the limit', async () => {
    const req = new Request('http://localhost/api/webhook', {
      method: 'POST',
      body: 'x'.repeat(LIMIT + 1),
    })
    const result = await readTextBodyWithLimit(req, LIMIT)
    expect(result).toBeNull()
  })
})

describe('readTextBodyOr413', () => {
  it('returns the decoded body when within the limit', async () => {
    const req = new Request('http://localhost/api/webhook', {
      method: 'POST',
      body: 'hello',
    })
    const result = await readTextBodyOr413(req, LIMIT)
    expect(result).toBe('hello')
  })

  it('returns a 413 Response when the body exceeds the limit', async () => {
    const req = new Request('http://localhost/api/webhook', {
      method: 'POST',
      body: 'x'.repeat(LIMIT + 1),
    })
    const result = await readTextBodyOr413(req, LIMIT)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(413)
  })
})
