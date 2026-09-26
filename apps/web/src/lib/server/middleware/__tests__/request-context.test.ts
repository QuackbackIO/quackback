/**
 * Tests for the request-context middleware core.
 *
 * Verifies the real request lifecycle behaviour: an ALS scope is open for the
 * duration of the request (so downstream logs carry request_id), the response
 * echoes x-request-id, and completion/failure are logged once at the boundary.
 */
import { describe, it, expect } from 'vitest'
import { handleRequestWithContext } from '../request-context'
import { getLogContext } from '@/lib/server/log-context'
import { createLogger } from '@/lib/server/logger'
import { countingQueryLogger } from '@/lib/server/request-metrics'
import { finishResponse } from '@/lib/server/finish-response'

function capture() {
  const lines: string[] = []
  const log = createLogger({
    level: 'info',
    destination: { write: (s: string) => void lines.push(s) },
  })
  return { log, records: () => lines.map((l) => JSON.parse(l)) }
}

describe('handleRequestWithContext', () => {
  it('runs next() inside an ALS scope carrying request_id and route', async () => {
    const { log } = capture()
    let seen: ReturnType<typeof getLogContext>
    const request = new Request('http://localhost/api/posts', { method: 'POST' })

    await handleRequestWithContext({
      request,
      log,
      next: async () => {
        seen = getLogContext()
        return { response: new Response(null, { status: 201 }) }
      },
    })

    expect(seen?.request_id).toBeDefined()
    expect(seen?.route).toBe('POST /api/posts')
  })

  it('reuses an inbound x-request-id and echoes it on the response', async () => {
    const { log } = capture()
    const request = new Request('http://localhost/x', {
      headers: { 'x-request-id': 'incoming-123' },
    })

    const result = await handleRequestWithContext({
      request,
      log,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })

    expect(result.response.headers.get('x-request-id')).toBe('incoming-123')
  })

  it('logs request completion with status and duration', async () => {
    const cap = capture()
    const request = new Request('http://localhost/health')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })

    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBe(200)
    expect(typeof completed.duration_ms).toBe('number')
    expect(completed.request_id).toBeDefined()
  })

  it('logs how many queries the request ran', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/posts')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => {
        countingQueryLogger.logQuery('select 1', [])
        countingQueryLogger.logQuery('select 2', [])
        return { response: new Response('ok', { status: 200 }) }
      },
    })

    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed.db_queries).toBe(2)
  })

  it('adds a Server-Timing header only when asked to', async () => {
    const run = (serverTiming: boolean) =>
      handleRequestWithContext({
        request: new Request('http://localhost/x'),
        log: capture().log,
        serverTiming,
        next: async () => {
          countingQueryLogger.logQuery('select 1', [])
          return { response: new Response('ok', { status: 200 }) }
        },
      })

    const on = await run(true)
    expect(on.response.headers.get('server-timing')).toMatch(
      /^app;dur=[\d.]+, db;desc="1 queries"$/
    )
    const off = await run(false)
    expect(off.response.headers.get('server-timing')).toBeNull()
  })

  it('hands the framework back the very response it produced', async () => {
    // The SSR handler disposes a streamed document whose response a middleware
    // replaced: it tears down the serializer that writes the streamed data and
    // closing tags, so the document never ends. Observing the body therefore
    // happens at the server entry, never by swapping the response here.
    const original = new Response(new ReadableStream({ start: (c) => c.close() }))
    const result = await handleRequestWithContext({
      request: new Request('http://localhost/'),
      log: capture().log,
      serverTiming: true,
      next: async () => ({ response: original }),
    })
    expect(result.response).toBe(original)
  })

  it('with Server-Timing on, logs the final count once a streamed body ends', async () => {
    const cap = capture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))

    const request = new Request('http://localhost/')
    const result = await handleRequestWithContext({
      request,
      log: cap.log,
      serverTiming: true,
      next: async () => {
        countingQueryLogger.logQuery('select 1', [])
        // A query that runs while the document streams, after the headers left.
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await gate
            countingQueryLogger.logQuery('select 2', [])
            controller.enqueue(new TextEncoder().encode('<html></html>'))
            controller.close()
          },
        })
        return { response: new Response(body, { status: 200 }) }
      },
    })

    expect(cap.records().find((r) => r.msg === 'request completed').db_queries).toBe(1)
    expect(cap.records().find((r) => r.msg === 'request finished')).toBeUndefined()

    // The server entry applies the hook to the final response.
    const sent = await finishResponse(request, result.response!)
    release()
    expect(await sent.text()).toBe('<html></html>')
    const finished = cap.records().find((r) => r.msg === 'request finished')
    expect(finished.db_queries).toBe(2)
    expect(finished.request_id).toBeDefined()
  })

  it('with Server-Timing on, logs finished at once for a bodyless response', async () => {
    const cap = capture()
    await handleRequestWithContext({
      request: new Request('http://localhost/'),
      log: cap.log,
      serverTiming: true,
      next: async () => ({ response: new Response(null, { status: 307 }) }),
    })
    expect(cap.records().filter((r) => r.msg === 'request finished')).toHaveLength(1)
  })

  it('never logs finished for a healthy probe', async () => {
    const cap = capture()
    const result = await handleRequestWithContext({
      request: new Request('http://localhost/api/health/ready'),
      log: cap.log,
      serverTiming: true,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })
    await result.response.text()
    expect(cap.records()).toHaveLength(0)
  })

  it('survives a context with no response attached yet', async () => {
    // A failing server function resolves the middleware chain without a
    // response: the error is carried as a value and serialized after this
    // boundary returns. Dereferencing it here threw a TypeError out of the
    // middleware, and the framework reported that to the client as an
    // unhandled 500 instead of the serialized error it had already built.
    const cap = capture()
    const request = new Request('http://localhost/_serverFn/abc')

    const result = await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({}) as { response?: Response },
    })

    expect(result).toEqual({})
    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBeUndefined()
    expect(cap.records().some((r) => r.msg === 'request failed')).toBe(false)
  })

  it.each(['/api/health', '/api/health/live', '/api/health/ready'])(
    'does NOT log completion for a healthy %s probe',
    async (path) => {
      const cap = capture()
      const request = new Request(`http://localhost${path}`)

      await handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => ({ response: new Response('ok', { status: 200 }) }),
      })

      expect(cap.records().find((r) => r.msg === 'request completed')).toBeUndefined()
    }
  )

  it('still logs /api/health when the probe is unhealthy (status >= 400)', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/health')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({ response: new Response('unhealthy', { status: 503 }) }),
    })

    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBe(503)
  })

  it('still logs failure when /api/health throws', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/health')

    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          throw new Error('probe boom')
        },
      })
    ).rejects.toThrow('probe boom')

    expect(cap.records().find((r) => r.msg === 'request failed')).toBeDefined()
  })

  it('logs failure and rethrows when next() throws', async () => {
    const cap = capture()
    const request = new Request('http://localhost/boom')
    const boom = new Error('kaboom')

    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          throw boom
        },
      })
    ).rejects.toThrow('kaboom')

    const failed = cap.records().find((r) => r.msg === 'request failed')
    expect(failed).toBeDefined()
    expect(failed.level).toBe('error')
  })
})
