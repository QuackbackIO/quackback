/**
 * The client address Better Auth sees must be the one the rest of the app
 * trusts: the socket peer on a direct install, the trusted hop behind proxies,
 * and never a header the client wrote.
 *
 * The adapter is checked on its own, then once through a real Better Auth
 * instance configured the way the app configures it, so a library upgrade that
 * stops reading `ipAddressHeaders` (or starts reading something else first)
 * fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { proxyConfig, mockGetRequestIP } = vi.hoisted(() => ({
  proxyConfig: { hops: 0, header: undefined as string | undefined },
  mockGetRequestIP: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get trustedProxyHops() {
      return proxyConfig.hops
    },
    get trustedClientIpHeader() {
      return proxyConfig.header
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: mockGetRequestIP,
}))

import {
  CLIENT_IP_HEADER,
  betterAuthIpAddressOptions,
  withTrustedClientIp,
  withTrustedClientIpArgs,
  withTrustedClientIpRequest,
} from '../client-ip'
import { signCustomerHost, signEdgeClientIp } from '@/lib/server/workspaces/saas-edge-host'

beforeEach(() => {
  proxyConfig.hops = 0
  proxyConfig.header = undefined
  mockGetRequestIP.mockReset()
})

describe('withTrustedClientIp', () => {
  it('uses the socket peer and ignores a spoofed X-Forwarded-For when no proxy is trusted', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const headers = withTrustedClientIp({ 'x-forwarded-for': '9.9.9.9' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
  })

  it('uses the trusted hop when one proxy is trusted', () => {
    proxyConfig.hops = 1
    mockGetRequestIP.mockReturnValue('10.0.0.1')
    const headers = withTrustedClientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.4' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.4')
  })

  it('overwrites a client-supplied copy of the private header', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const headers = withTrustedClientIp({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
  })

  it('drops a client-supplied copy when no address can be resolved', () => {
    mockGetRequestIP.mockReturnValue(undefined)
    const headers = withTrustedClientIp({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false)
  })

  it('uses the operator-trusted client address header when configured', () => {
    proxyConfig.header = 'x-real-ip'
    proxyConfig.hops = 1
    mockGetRequestIP.mockReturnValue('10.0.0.1')
    const request = withTrustedClientIpRequest(
      new Request('https://acme.example/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '9.9.9.9, 10.0.0.3',
          'x-real-ip': '198.51.100.4',
          [CLIENT_IP_HEADER]: '9.9.9.9',
        },
        body: '{}',
      })
    )
    expect(request.headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.4')
  })

  it('leaves the caller headers untouched', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const original = new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    withTrustedClientIp(original)
    expect(original.get(CLIENT_IP_HEADER)).toBe('9.9.9.9')
  })
})

describe('a visitor address signed by the custom-host edge proxy', () => {
  const secret = 'edge-test-secret'
  const origin = 'origin.up.example'
  const customer = 'feedback.customer.test'
  const nowS = Math.floor(Date.now() / 1000)

  function edgeRequestHeaders(ipSig: string): Record<string, string> {
    return {
      host: origin,
      'x-forwarded-for': '9.9.9.9, 10.0.0.2',
      'x-quackback-customer-host': customer,
      'x-quackback-customer-host-sig': signCustomerHost(secret, customer),
      'x-quackback-edge-client-ip': '198.51.100.23',
      'x-quackback-edge-client-ip-sig': ipSig,
      [CLIENT_IP_HEADER]: '9.9.9.9',
    }
  }

  beforeEach(() => {
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', secret)
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', origin)
    mockGetRequestIP.mockReturnValue('10.0.0.2')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reaches Better Auth through the private header', () => {
    const sig = `${nowS}.${signEdgeClientIp(secret, customer, '198.51.100.23', nowS)}`
    const request = withTrustedClientIpRequest(
      new Request(`https://${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: edgeRequestHeaders(sig),
        body: '{}',
      })
    )
    expect(request.headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.23')
  })

  it('is ignored when its signature does not verify', () => {
    const sig = `${nowS}.${signEdgeClientIp('wrong', customer, '198.51.100.23', nowS)}`
    const headers = withTrustedClientIp(edgeRequestHeaders(sig))
    expect(headers.get(CLIENT_IP_HEADER)).toBe('10.0.0.2')
  })
})

describe('withTrustedClientIpRequest', () => {
  it('keeps method, url and body', async () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const request = withTrustedClientIpRequest(
      new Request('https://acme.example/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ email: 'a@acme.example' }),
      })
    )
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://acme.example/api/auth/sign-in/email')
    expect(request.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
    expect(await request.json()).toEqual({ email: 'a@acme.example' })
  })

  it('accepts the request object the Node dev server hands to route handlers', async () => {
    const { NodeRequest } = await loadSrvxNode()
    mockGetRequestIP.mockReturnValue('203.0.113.8')

    // A real HTTP round trip, so the input is exactly what the Node adapter
    // builds from an incoming message: a Request subclass the platform
    // constructor cannot copy from.
    const seen = await new Promise<{ ip: string | null; method: string; body: string }>(
      (resolve, reject) => {
        const server = createServer((req, res) => {
          const nodeRequest = new NodeRequest({ req, res }) as unknown as Request
          Promise.resolve()
            .then(async () => {
              const rebuilt = withTrustedClientIpRequest(nodeRequest)
              return {
                ip: rebuilt.headers.get(CLIENT_IP_HEADER),
                method: rebuilt.method,
                body: await rebuilt.text(),
              }
            })
            .then(resolve, reject)
            .finally(() => {
              res.end()
              server.close()
            })
        })
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo
          fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [CLIENT_IP_HEADER]: '9.9.9.9' },
            body: '{"email":"a@acme.example"}',
          }).catch(reject)
        })
      }
    )

    expect(seen).toEqual({
      ip: '203.0.113.8',
      method: 'POST',
      body: '{"email":"a@acme.example"}',
    })
  })
})

/**
 * The Node adapter TanStack Start's dev server wraps requests in. Not a direct
 * dependency, so it is resolved from the plugin that uses it.
 */
async function loadSrvxNode(): Promise<{
  NodeRequest: new (ctx: { req: IncomingMessage; res: ServerResponse }) => unknown
}> {
  const store = join(
    fileURLToPath(new URL('../../../../../../../', import.meta.url)),
    'node_modules/.bun'
  )
  const plugin = readdirSync(store).find((name) => name.startsWith('@tanstack+start-plugin-core@'))
  if (!plugin) throw new Error('@tanstack/start-plugin-core is not installed')
  const require = createRequire(
    join(store, plugin, 'node_modules/@tanstack/start-plugin-core/package.json')
  )
  return import(pathToFileURL(require.resolve('srvx/node')).href)
}

describe('withTrustedClientIpArgs', () => {
  it('rewrites the headers of a server-side api call', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const [arg] = withTrustedClientIpArgs([
      { headers: new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' }), body: { x: 1 } },
    ]) as [{ headers: Headers; body: unknown }]
    expect(arg.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
    expect(arg.body).toEqual({ x: 1 })
  })

  it('passes calls without headers through', () => {
    const args = [{ body: { x: 1 } }]
    expect(withTrustedClientIpArgs(args)).toBe(args)
    expect(withTrustedClientIpArgs([])).toEqual([])
  })
})

describe('through a real Better Auth instance', () => {
  const keys: string[] = []
  const counters = new Map<string, number>()
  const auth = betterAuth({
    baseURL: 'https://acme.example',
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    advanced: { ipAddress: betterAuthIpAddressOptions },
    rateLimit: {
      enabled: true,
      customStorage: {
        async consume(key: string, rule: { window: number; max: number }) {
          keys.push(key)
          const count = (counters.get(key) ?? 0) + 1
          counters.set(key, count)
          return count > rule.max
            ? { allowed: false, retryAfter: rule.window }
            : { allowed: true, retryAfter: null }
        },
      },
    },
  })

  function wrongPassword(peer: string, headers: Record<string, string> = {}) {
    mockGetRequestIP.mockReturnValue(peer)
    return auth.handler(
      withTrustedClientIpRequest(
        new Request('https://acme.example/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ email: 'nobody@acme.example', password: 'wrong-password' }),
        })
      )
    )
  }

  beforeEach(() => {
    keys.length = 0
    counters.clear()
  })

  it('buckets by the socket peer, not by a spoofed X-Forwarded-For', async () => {
    await wrongPassword('203.0.113.21', { 'x-forwarded-for': '9.9.9.9' })
    expect(keys).toEqual(['203.0.113.21|/sign-in/email'])
  })

  it('ignores a client-supplied private header', async () => {
    await wrongPassword('203.0.113.22', { [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(keys).toEqual(['203.0.113.22|/sign-in/email'])
  })

  it('keeps one client locked out without locking out another, spoof or not', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await wrongPassword('203.0.113.31')).status)
    expect(statuses.at(-1)).toBe(429)

    // The locked-out client cannot buy a fresh bucket with a forwarding header.
    expect((await wrongPassword('203.0.113.31', { 'x-forwarded-for': '9.9.9.9' })).status).toBe(429)
    // A different client is unaffected.
    expect((await wrongPassword('203.0.113.32')).status).not.toBe(429)
  })
})
