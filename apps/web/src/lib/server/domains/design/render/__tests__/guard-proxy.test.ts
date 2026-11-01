import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: vi.fn(async (url: string) => {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    if (host === 'brand.example.com') return { safe: true, address: '127.0.0.1', family: 4 }
    return { safe: false, reason: 'ssrf-rejected' }
  }),
}))

const { allowedAddress, startGuardProxy, tunnelTarget } = await import('../guard-proxy')

/** Sends one request through the proxy and returns its first response line. */
function ask(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(request))
    let got = ''
    socket.on('data', (chunk) => {
      got += chunk.toString()
      if (got.includes('\r\n')) {
        socket.destroy()
        resolve(got.slice(0, got.indexOf('\r\n')))
      }
    })
    socket.on('error', reject)
    socket.on('close', () => resolve(got.split('\r\n')[0] ?? ''))
  })
}

describe('tunnelTarget', () => {
  it('reads the host and port of a CONNECT request, and nothing else', () => {
    expect(tunnelTarget('CONNECT example.com:443 HTTP/1.1\r\nHost: x\r\n\r\n')).toEqual({
      host: 'example.com',
      port: 443,
    })
    expect(tunnelTarget('CONNECT [2001:db8::1]:443 HTTP/1.1\r\n\r\n')).toEqual({
      host: '2001:db8::1',
      port: 443,
    })
    expect(tunnelTarget('GET http://example.com/ HTTP/1.1\r\n\r\n')).toBeNull()
  })
})

describe('allowedAddress', () => {
  it('allows a public host on the secure port only', async () => {
    expect(await allowedAddress('brand.example.com', 443)).toEqual({
      address: '127.0.0.1',
      family: 4,
    })
    expect(await allowedAddress('brand.example.com', 8443)).toBeNull()
  })

  it('refuses internal names before resolving them', async () => {
    expect(await allowedAddress('postgres.railway.internal', 443)).toBeNull()
    expect(await allowedAddress('localhost', 443)).toBeNull()
    expect(await allowedAddress('printer.local', 443)).toBeNull()
  })

  it('refuses a host the address check rejects', async () => {
    expect(await allowedAddress('10.0.0.5', 443)).toBeNull()
  })
})

describe('startGuardProxy', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('refuses plain HTTP and tunnels to refused hosts', async () => {
    const proxy = await startGuardProxy()
    close = proxy.close
    expect(await ask(proxy.port, 'GET http://brand.example.com/ HTTP/1.1\r\n\r\n')).toContain('403')
    expect(await ask(proxy.port, 'CONNECT 169.254.169.254:443 HTTP/1.1\r\n\r\n')).toContain('403')
    expect(proxy.refused.has('169.254.169.254')).toBe(true)
  })

  it('tunnels to an allowed host, at the address it checked', async () => {
    const { createServer } = await import('node:net')
    // An upstream standing in for the site, on the address the check returned.
    const upstream = createServer((socket) => socket.end('hello'))
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
    const port = (upstream.address() as { port: number }).port
    const proxy = await startGuardProxy({ securePort: port })
    close = async () => {
      await proxy.close()
      upstream.close()
    }
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: proxy.port }, () =>
        socket.write(`CONNECT brand.example.com:${port} HTTP/1.1\r\n\r\n`)
      )
      let got = ''
      socket.on('data', (chunk) => (got += chunk.toString()))
      socket.on('close', () => resolve(got))
      socket.on('error', reject)
    })
    expect(reply).toBe('HTTP/1.1 200 Connection Established\r\n\r\nhello')
  })
})
