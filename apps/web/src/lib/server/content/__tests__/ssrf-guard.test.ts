// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isSafeScheme,
  isPrivateAddress,
  checkUrlSafety,
  safeFetch,
  SsrfError,
  ResponseTooLargeError,
  TimeoutError,
} from '../ssrf-guard'

vi.mock('node:dns/promises', () => ({
  default: {},
  lookup: vi.fn(),
}))

const httpsRequestMock = vi.fn()
const httpRequestMock = vi.fn()
vi.mock('node:https', () => ({ default: {}, request: (...a: unknown[]) => httpsRequestMock(...a) }))
vi.mock('node:http', () => ({ default: {}, request: (...a: unknown[]) => httpRequestMock(...a) }))

import { lookup } from 'node:dns/promises'
const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>

/**
 * Build a fake `node:https`/`node:http` `request` implementation that
 * replays a canned response. The returned `req` exposes `write` / `end`
 * / `destroy` spies; `end()` invokes the response callback, then emits
 * the body chunks (respecting `res.destroy()` so the body-cap path can
 * stop the stream).
 */
function requestImpl(spec: {
  status?: number
  statusMessage?: string
  headers?: Record<string, string | string[]>
  chunks?: Array<string | Buffer>
}) {
  return (_options: unknown, cb: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
    }
    req.write = vi.fn()
    // Faithful to node: destroying a request with an error emits 'error'.
    req.destroy = vi.fn((err?: unknown) => {
      if (err) req.emit('error', err)
    })
    req.end = vi.fn(() => {
      let destroyed = false
      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number
        statusMessage?: string
        headers: Record<string, string | string[]>
        destroy: ReturnType<typeof vi.fn>
      }
      res.statusCode = spec.status ?? 200
      res.statusMessage = spec.statusMessage ?? 'OK'
      res.headers = spec.headers ?? {}
      res.destroy = vi.fn(() => {
        destroyed = true
      })
      cb(res)
      queueMicrotask(() => {
        for (const c of spec.chunks ?? []) {
          if (destroyed) break
          res.emit('data', Buffer.isBuffer(c) ? c : Buffer.from(c))
        }
        if (!destroyed) res.emit('end')
      })
    })
    return req
  }
}

describe('isSafeScheme', () => {
  it('accepts https and http', () => {
    expect(isSafeScheme('https://example.com/img.png')).toBe(true)
    expect(isSafeScheme('http://example.com/img.png')).toBe(true)
  })

  it('rejects file, ftp, gopher, dict, ldap, javascript', () => {
    expect(isSafeScheme('file:///etc/passwd')).toBe(false)
    expect(isSafeScheme('ftp://example.com/x')).toBe(false)
    expect(isSafeScheme('gopher://example.com/')).toBe(false)
    expect(isSafeScheme('dict://example.com/')).toBe(false)
    expect(isSafeScheme('ldap://example.com/')).toBe(false)
    expect(isSafeScheme('javascript:alert(1)')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeScheme('not a url')).toBe(false)
    expect(isSafeScheme('')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('blocks IPv4 loopback and link-local', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('127.255.255.254')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
  })

  it('blocks RFC 1918 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.254')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
  })

  it('blocks this-network and CGNAT', () => {
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
  })

  it('blocks IPv6 loopback, unique-local, link-local', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('fc00::1')).toBe(true)
    expect(isPrivateAddress('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
  })

  it('blocks IPv4-mapped IPv6 private addresses', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows IPv4-mapped IPv6 public addresses', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
    expect(isPrivateAddress('::ffff:1.1.1.1')).toBe(false)
  })

  it('blocks the IPv6 documentation prefix 2001:db8::/32', () => {
    expect(isPrivateAddress('2001:db8::1')).toBe(true)
    expect(isPrivateAddress('2001:0db8:1234::1')).toBe(true)
  })

  it('blocks IPv6 transition/tunneling ranges (NAT64, 6to4, Teredo)', () => {
    expect(isPrivateAddress('64:ff9b::0a00:0001')).toBe(true) // NAT64 embedding 10.0.0.1
    expect(isPrivateAddress('2002:0a00:0001::')).toBe(true) // 6to4 embedding 10.0.0.1
    expect(isPrivateAddress('2001:0000:4136:e378::1')).toBe(true) // Teredo (2nd hextet zero)
    // A routable global 2001: (non-zero second hextet) stays allowed.
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false) // Google public DNS
  })

  it('blocks hextet-form IPv4-mapped IPv6 private addresses', () => {
    // ::ffff:7f00:1 encodes 127.0.0.1
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true)
    // ::ffff:0a00:1 encodes 10.0.0.1
    expect(isPrivateAddress('::ffff:0a00:1')).toBe(true)
    // ::ffff:c0a8:1 encodes 192.168.0.1
    expect(isPrivateAddress('::ffff:c0a8:1')).toBe(true)
    // ::ffff:a9fe:a9fe encodes 169.254.169.254 (cloud metadata)
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true)
    // ::ffff:ac10:1 encodes 172.16.0.1
    expect(isPrivateAddress('::ffff:ac10:1')).toBe(true)
  })

  it('allows hextet-form IPv4-mapped IPv6 public addresses', () => {
    // ::ffff:0808:0808 encodes 8.8.8.8
    expect(isPrivateAddress('::ffff:0808:0808')).toBe(false)
    // ::ffff:0101:0101 encodes 1.1.1.1
    expect(isPrivateAddress('::ffff:0101:0101')).toBe(false)
  })
})

describe('checkUrlSafety', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('returns safe:true + the pinned address for a public host', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])

    const result = await checkUrlSafety('https://example.com/img.png')
    expect(result).toEqual({
      safe: true,
      address: '93.184.216.34',
      family: 4,
    })
  })

  it('rejects when any resolved address is private', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    const result = await checkUrlSafety('https://evil.example.com/img.png')
    expect(result).toEqual({ safe: false, reason: 'ssrf-rejected' })
  })

  it('rejects disallowed schemes without looking up', async () => {
    const result = await checkUrlSafety('file:///etc/passwd')
    expect(result).toEqual({ safe: false, reason: 'scheme-rejected' })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects when DNS lookup throws', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await checkUrlSafety('https://does-not-exist.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })

  it('rejects when DNS returns zero addresses', async () => {
    lookupMock.mockResolvedValueOnce([])
    const result = await checkUrlSafety('https://empty.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })
})

describe('safeFetch', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    httpsRequestMock.mockReset()
    httpRequestMock.mockReset()
  })

  it('pins the connection to the validated IP and carries the original host for Host + SNI', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    httpsRequestMock.mockImplementation(requestImpl({ status: 200, chunks: ['ok'] }))

    const res = await safeFetch('https://idp.example.com/.well-known/openid-configuration?x=1')

    expect(httpsRequestMock).toHaveBeenCalledTimes(1)
    expect(httpRequestMock).not.toHaveBeenCalled()
    const opts = httpsRequestMock.mock.calls[0][0] as Record<string, unknown>
    // Connection target is the validated IP — no second DNS resolution.
    expect(opts.hostname).toBe('93.184.216.34')
    expect(opts.family).toBe(4)
    expect(opts.port).toBe(443)
    expect(opts.path).toBe('/.well-known/openid-configuration?x=1')
    // SNI + HTTP Host carry the original hostname so vhosted IdPs route
    // correctly and the cert is validated against the real name.
    expect(opts.servername).toBe('idp.example.com')
    expect((opts.headers as Record<string, string>).host).toBe('idp.example.com')
    expect(typeof opts.checkServerIdentity).toBe('function')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('throws SsrfError and never dials when the host resolves to a private address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])

    await expect(safeFetch('https://metadata.evil.test/latest/meta-data/')).rejects.toMatchObject({
      name: 'SsrfError',
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('throws SsrfError for a disallowed scheme without resolving DNS', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfError)
    expect(lookupMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('returns a 3xx response verbatim without following the redirect', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    httpsRequestMock.mockImplementation(
      requestImpl({ status: 302, headers: { location: 'https://internal.evil.test/' } })
    )

    const res = await safeFetch('https://idp.example.com/authorize')

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://internal.evil.test/')
    // One dial only — the redirect target was not fetched.
    expect(httpsRequestMock).toHaveBeenCalledTimes(1)
  })

  it('caps the response body at maxResponseBytes and destroys the socket', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    let capturedRes: { destroy: ReturnType<typeof vi.fn> } | undefined
    httpsRequestMock.mockImplementation((_o: unknown, cb: (res: unknown) => void) => {
      const impl = requestImpl({ status: 200, chunks: ['AAAAAAAA', 'BBBBBBBB'] })
      return impl(_o, (res) => {
        capturedRes = res as { destroy: ReturnType<typeof vi.fn> }
        cb(res)
      })
    })

    const res = await safeFetch('https://idp.example.com/huge', { maxResponseBytes: 10 })

    // First 8-byte chunk fits; the second pushes total past 10, so the
    // stream is cut and only what arrived before the cap is kept.
    expect(await res.text()).toBe('AAAAAAAA')
    expect(capturedRes?.destroy).toHaveBeenCalled()
  })

  it('rejects with ResponseTooLargeError and destroys the socket when onOverflow is "error"', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    let capturedRes: { destroy: ReturnType<typeof vi.fn> } | undefined
    httpsRequestMock.mockImplementation((_o: unknown, cb: (res: unknown) => void) => {
      const impl = requestImpl({ status: 200, chunks: ['AAAAAAAA', 'BBBBBBBB'] })
      return impl(_o, (res) => {
        capturedRes = res as { destroy: ReturnType<typeof vi.fn> }
        cb(res)
      })
    })

    // 8-byte chunk fits; the second chunk pushes total past 10. In 'error'
    // mode the over-cap body is a hard rejection, not a silent truncation.
    await expect(
      safeFetch('https://idp.example.com/huge', { maxResponseBytes: 10, onOverflow: 'error' })
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
    expect(capturedRes?.destroy).toHaveBeenCalled()
  })

  it('rejects with a typed TimeoutError (name "TimeoutError") when the request times out', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    // Drive the timeout path: end() emits 'timeout' instead of replying.
    httpsRequestMock.mockImplementation((_o: unknown) => {
      const req = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>
        end: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
      }
      req.write = vi.fn()
      req.destroy = vi.fn((err?: unknown) => {
        if (err) req.emit('error', err)
      })
      req.end = vi.fn(() => {
        queueMicrotask(() => req.emit('timeout'))
      })
      return req
    })

    const err = await safeFetch('https://slow.example.com/x').catch((e) => e)
    expect(err).toBeInstanceOf(TimeoutError)
    expect((err as Error).name).toBe('TimeoutError')
  })

  it('uses node:http with no TLS options for an http:// URL', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    httpRequestMock.mockImplementation(requestImpl({ status: 200, chunks: ['ok'] }))

    await safeFetch('http://idp.example.com/x')

    expect(httpRequestMock).toHaveBeenCalledTimes(1)
    expect(httpsRequestMock).not.toHaveBeenCalled()
    const opts = httpRequestMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.port).toBe(80)
    expect(opts.servername).toBeUndefined()
    expect(opts.checkServerIdentity).toBeUndefined()
  })

  it('returns a null-body Response for a 304 without throwing', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    httpsRequestMock.mockImplementation(requestImpl({ status: 304 }))

    const res = await safeFetch('https://idp.example.com/jwks')
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  it('writes the request body for a POST', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    let req: { write: ReturnType<typeof vi.fn> } | undefined
    httpsRequestMock.mockImplementation((o: unknown, cb: (res: unknown) => void) => {
      req = requestImpl({ status: 200, chunks: ['ok'] })(o, cb) as {
        write: ReturnType<typeof vi.fn>
      }
      return req
    })

    await safeFetch('https://idp.example.com/token', {
      method: 'POST',
      body: 'grant_type=authorization_code',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    const opts = httpsRequestMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded'
    )
    expect(req?.write).toHaveBeenCalledWith('grant_type=authorization_code')
  })
})
