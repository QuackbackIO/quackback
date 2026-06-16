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

  it('does NOT log completion for a healthy /api/health probe', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/health')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })

    expect(cap.records().find((r) => r.msg === 'request completed')).toBeUndefined()
  })

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
