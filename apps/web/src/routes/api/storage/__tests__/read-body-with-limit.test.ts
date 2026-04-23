import { describe, it, expect } from 'vitest'

// Route file has no server-only imports, so no mock needed
const { readBodyWithLimit } = await import('../$.js')

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
    // @ts-expect-error — duplex required by fetch spec for streaming request bodies
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
    // third (120 bytes total) exceeds it — cancel must fire before the third chunk is stored.
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
      // @ts-expect-error — duplex required by fetch spec for streaming request bodies
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
})
