/**
 * The CIMD fetch transport is the SSRF boundary: a client_id is a URL anyone
 * can choose, and the server fetches it. These tests run the transport the app
 * ships (`@better-auth/cimd/node`) against real TLS servers on loopback.
 *
 * Production runs on Bun, and the transport's pin relies on `node:https`
 * honouring a custom `lookup`. CI therefore runs this file twice: under Node
 * with the rest of the suite, and under Bun (`bun --bun vitest run …` with
 * CIMD_TRANSPORT_EXPECT_BUN=1, which this file checks so a Bun run cannot pass
 * on Node by mistake).
 *
 * What must hold:
 * - a client_id whose host is, or resolves to, a non-public address is refused
 *   before any connection (loopback, RFC 1918, link local and cloud metadata,
 *   CGNAT, IPv6 loopback and ULA, IPv4-mapped IPv6, integer and hex forms);
 * - DNS is resolved once, and the connection goes to the validated address,
 *   not to whatever a second lookup would say (no rebinding window);
 * - Host, SNI and certificate verification stay on the hostname;
 * - redirects are returned, never followed;
 * - an abort tears the request down, before headers and mid-body.
 *
 * Size, content type and JSON checks sit in the plugin above the transport;
 * `cimd-flow.db.test.ts` covers those.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const control = vi.hoisted(() => ({
  /** hostname → answers, in order; the last answer repeats. */
  dns: new Map<string, Array<Array<{ address: string; family: 4 | 6 }>>>(),
  lookups: [] as string[],
  /**
   * Public address → loopback test server. Applied inside the `lookup` the
   * transport hands to `node:https`, so a connection reaches a test server only
   * if the runtime connects through that pinned lookup.
   */
  route: new Map<string, string>(),
  ca: [] as string[],
  connects: 0,
}))

vi.mock('node:dns/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...real,
    lookup: async (hostname: string) => {
      control.lookups.push(hostname)
      const answers = control.dns.get(hostname)
      if (!answers) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })
      return answers.length > 1 ? answers.shift()! : answers[0]
    },
  }
})

type LookupAnswer = { address: string; family: number }
type Lookup = (
  hostname: string,
  options: { all?: boolean },
  callback: (error: Error | null, address: string | LookupAnswer[], family?: number) => void
) => void

// Trust the test CA for this file's servers (verification itself stays on),
// and route the documentation addresses below to loopback servers through the
// transport's own lookup.
vi.mock('node:https', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:https')>()
  const request = ((
    url: URL,
    options: Record<string, unknown> & { lookup?: Lookup },
    callback: never
  ) => {
    control.connects += 1
    const pinned = options.lookup
    const lookup: Lookup | undefined = pinned
      ? (hostname, opts, cb) =>
          pinned(hostname, opts, (error, address, family) => {
            if (error || typeof address !== 'string') {
              const list = Array.isArray(address) ? address : []
              return cb(
                error,
                list.map((a) => ({ ...a, address: control.route.get(a.address) ?? a.address }))
              )
            }
            cb(null, control.route.get(address) ?? address, family)
          })
      : undefined
    return real.request(url, { ...options, lookup, ca: control.ca }, callback)
  }) as unknown as typeof real.request
  return { ...real, request, default: { ...real, request } }
})

const { fetchClientMetadataResource } = await import('@better-auth/cimd/node')

const HOST = 'pin-test.invalid'
/** Public addresses the transport validates and pins; the test routes them to loopback. */
const PUBLIC_A = '1.1.1.1'
const PUBLIC_B = '8.8.8.8'
const OTHER_HOST = 'other-test.invalid'

let dir = ''
let port = 0
const servers: Server[] = []
const seen: Array<{ boundTo: string; servername: string | null; host?: string; path?: string }> = []

function makeCert(name: string): { key: string; cert: string } {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, `${name}.key`),
      '-out',
      join(dir, `${name}.crt`),
      '-days',
      '2',
      '-subj',
      `/CN=${name}`,
      '-addext',
      `subjectAltName=DNS:${name}`,
    ],
    { stdio: 'ignore' }
  )
  return {
    key: readFileSync(join(dir, `${name}.key`), 'utf8'),
    cert: readFileSync(join(dir, `${name}.crt`), 'utf8'),
  }
}

function listen(address: string, tls: { key: string; cert: string }): Promise<void> {
  const server = createServer(tls, (req, res) => {
    seen.push({
      boundTo: address,
      servername: (req.socket as { servername?: string }).servername ?? null,
      host: req.headers.host,
      path: req.url,
    })
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `https://${HOST}:${port}/target` })
      res.end()
      return
    }
    if (req.url === '/stall-headers') return // never answers
    if (req.url === '/stall-body') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"client_id":')
      return // never finishes
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ boundTo: address }))
  })
  servers.push(server)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, address, () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
}

beforeEach(() => {
  control.dns.clear()
  control.lookups = []
  control.route.clear()
  control.connects = 0
  seen.length = 0
})

describe('CIMD fetch transport', () => {
  it('runs on the runtime CI asked for', () => {
    if (process.env.CIMD_TRANSPORT_EXPECT_BUN === '1') {
      expect(process.versions.bun, 'expected to run under Bun').toBeTruthy()
    }
  })

  describe('refuses a non-public host without connecting', () => {
    it.each([
      'https://127.0.0.1/client.json',
      'https://127.0.0.2/client.json',
      'https://10.0.0.1/client.json',
      'https://172.16.0.1/client.json',
      'https://192.168.1.1/client.json',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/client.json',
      'https://0.0.0.0/client.json',
      'https://[::1]/client.json',
      'https://[fd00::1]/client.json',
      'https://[fe80::1]/client.json',
      'https://[::ffff:127.0.0.1]/client.json',
      'https://[::ffff:a9fe:a9fe]/client.json',
      'https://2130706433/client.json',
      'https://0x7f000001/client.json',
      'https://0177.0.0.1/client.json',
    ])('%s', async (url) => {
      await expect(fetchClientMetadataResource(url)).rejects.toThrow(/public-routable/)
      expect(control.connects).toBe(0)
      expect(control.lookups).toEqual([])
    })

    it.each([
      ['loopback', [{ address: '127.0.0.1', family: 4 as const }]],
      ['IPv6 loopback', [{ address: '::1', family: 6 as const }]],
      ['RFC 1918', [{ address: '10.1.2.3', family: 4 as const }]],
      ['cloud metadata', [{ address: '169.254.169.254', family: 4 as const }]],
      ['IPv4-mapped loopback', [{ address: '::ffff:127.0.0.1', family: 6 as const }]],
      [
        'one private answer among public ones',
        [
          { address: '93.184.215.14', family: 4 as const },
          { address: '10.0.0.1', family: 4 as const },
        ],
      ],
    ])('a hostname that resolves to %s', async (_label, answers) => {
      control.dns.set('evil.example', [answers])
      await expect(fetchClientMetadataResource('https://evil.example/client.json')).rejects.toThrow(
        /public-routable/
      )
      expect(control.lookups).toEqual(['evil.example'])
      expect(control.connects).toBe(0)
    })
  })

  it('refuses a plain HTTP URL and a non-GET method before DNS', async () => {
    await expect(fetchClientMetadataResource('http://example.com/client.json')).rejects.toThrow(
      /HTTPS/
    )
    await expect(
      fetchClientMetadataResource('https://example.com/client.json', { method: 'POST' })
    ).rejects.toThrow(/GET and HEAD/)
    expect(control.lookups).toEqual([])
    expect(control.connects).toBe(0)
  })

  // Needs 127.0.0.2-4 (Linux routes all of 127/8 to loopback; macOS does not
  // without aliases) and the openssl CLI to mint test certificates.
  describe.skipIf(process.platform !== 'linux')('against loopback TLS servers', () => {
    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'cimd-transport-'))
      const pinned = makeCert(HOST)
      const other = makeCert(OTHER_HOST)
      control.ca = [pinned.cert, other.cert]
      // Same port on three loopback addresses, so only the address tells them apart.
      await listen('127.0.0.2', pinned)
      await listen('127.0.0.3', pinned)
      await listen('127.0.0.4', other)
    })

    afterAll(() => {
      for (const server of servers) server.close()
      rmSync(dir, { recursive: true, force: true })
    })

    it('resolves once and connects to the validated address, keeping Host and SNI', async () => {
      control.route.set(PUBLIC_A, '127.0.0.2')
      control.route.set(PUBLIC_B, '127.0.0.3')
      // A second lookup would rebind to another server. It must never happen:
      // the hostname is `.invalid`, so only the pinned answer can reach anything.
      control.dns.set(HOST, [
        [{ address: PUBLIC_A, family: 4 }],
        [{ address: PUBLIC_B, family: 4 }],
      ])
      const res = await fetchClientMetadataResource(`https://${HOST}:${port}/client.json`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ boundTo: '127.0.0.2' })
      expect(control.lookups).toEqual([HOST])
      expect(seen).toEqual([
        { boundTo: '127.0.0.2', servername: HOST, host: `${HOST}:${port}`, path: '/client.json' },
      ])
    })

    it('verifies the certificate against the hostname, not the pinned address', async () => {
      control.route.set(PUBLIC_A, '127.0.0.4')
      control.dns.set(HOST, [[{ address: PUBLIC_A, family: 4 }]])
      // 127.0.0.4 presents a certificate for another name.
      await expect(
        fetchClientMetadataResource(`https://${HOST}:${port}/client.json`)
      ).rejects.toThrow(/altnames|certificate/i)
      expect(seen).toEqual([])
    })

    it('returns a redirect instead of following it', async () => {
      control.route.set(PUBLIC_A, '127.0.0.2')
      control.dns.set(HOST, [[{ address: PUBLIC_A, family: 4 }]])
      const res = await fetchClientMetadataResource(`https://${HOST}:${port}/redirect`, {
        redirect: 'error',
      })
      expect(res.status).toBe(302)
      expect(res.redirected).toBe(false)
      expect(seen.map((s) => s.path)).toEqual(['/redirect'])
      expect(control.lookups).toEqual([HOST])
    })

    it('tears the request down on abort, before headers and mid-body', async () => {
      control.route.set(PUBLIC_A, '127.0.0.2')
      control.dns.set(HOST, [[{ address: PUBLIC_A, family: 4 }]])

      const started = Date.now()
      await expect(
        fetchClientMetadataResource(`https://${HOST}:${port}/stall-headers`, {
          signal: AbortSignal.timeout(300),
        })
      ).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(3000)

      const controller = new AbortController()
      const res = await fetchClientMetadataResource(`https://${HOST}:${port}/stall-body`, {
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      const body = res.text()
      setTimeout(() => controller.abort(), 200)
      await expect(body).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(5000)
    })
  })
})
