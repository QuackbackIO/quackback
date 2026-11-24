// @vitest-environment node
/**
 * The one SSRF exception: outgoing webhooks may reach the e2e suite's own
 * https sink, behind the harness gate. Everything else stays refused.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeFetch } from '../ssrf-guard'

vi.mock('node:dns/promises', () => ({ default: {}, lookup: vi.fn() }))
const httpsRequestMock = vi.fn()
const httpRequestMock = vi.fn()
vi.mock('node:https', () => ({ default: {}, request: (...a: unknown[]) => httpsRequestMock(...a) }))
vi.mock('node:http', () => ({ default: {}, request: (...a: unknown[]) => httpRequestMock(...a) }))

import { lookup } from 'node:dns/promises'
const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>

/** A request double that answers with `status` and an empty body. */
function respondWith(status: number) {
  return (_options: unknown, cb: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
    }
    req.write = vi.fn()
    req.destroy = vi.fn()
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number
        statusMessage: string
        headers: Record<string, string>
        destroy: () => void
      }
      res.statusCode = status
      res.statusMessage = ''
      res.headers = {}
      res.destroy = () => {}
      cb(res)
      queueMicrotask(() => res.emit('end'))
    })
    return req
  }
}

const SINK = 'https://webhook-sink.localhost:4011/hooks/abc'
const GATE_ENV: Record<string, string> = {
  E2E_HARNESS: '1',
  BASE_URL: 'http://acme.localhost:3000',
  E2E_WEBHOOK_SINK_HOST: 'webhook-sink.localhost:4011',
}
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  lookupMock.mockReset()
  httpsRequestMock.mockReset()
  httpRequestMock.mockReset()
  for (const key of Object.keys(GATE_ENV)) saved[key] = process.env[key]
  Object.assign(process.env, GATE_ENV)
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('safeFetch e2e webhook sink allowance', () => {
  it('dials the sink on loopback when the webhook caller asks and the gate is open', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    httpsRequestMock.mockImplementation(respondWith(204))

    const res = await safeFetch(SINK, { method: 'POST', allowE2eWebhookSink: true })

    expect(res.status).toBe(204)
    const opts = httpsRequestMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.hostname).toBe('127.0.0.1')
    // The certificate is still checked, against the sink's name.
    expect(opts.servername).toBe('webhook-sink.localhost')
    expect(typeof opts.checkServerIdentity).toBe('function')
  })

  it('refuses the sink when the caller did not ask (every other safeFetch user)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(safeFetch(SINK, { method: 'POST' })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('refuses the sink without the harness flag', async () => {
    delete process.env.E2E_HARNESS
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(safeFetch(SINK, { allowE2eWebhookSink: true })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('refuses the sink with the flag on a public BASE_URL', async () => {
    process.env.BASE_URL = 'https://feedback.example.com'
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(safeFetch(SINK, { allowE2eWebhookSink: true })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('refuses the sink name when any address it resolves to is private but not loopback', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(safeFetch(SINK, { allowE2eWebhookSink: true })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('still refuses every other private or http address for a webhook', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    for (const url of [
      'http://webhook-sink.localhost:4011/hooks/abc',
      'https://other.localhost:4011/',
      'https://webhook-sink.localhost:9999/',
      'https://localhost:4011/',
    ]) {
      await expect(safeFetch(url, { allowE2eWebhookSink: true }), url).rejects.toMatchObject({
        reason: 'ssrf-rejected',
      })
    }
    expect(httpsRequestMock).not.toHaveBeenCalled()
    expect(httpRequestMock).not.toHaveBeenCalled()
  })
})
