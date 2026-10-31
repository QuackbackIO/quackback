/**
 * The proxy every request of a rendered read goes through. It tunnels secure
 * connections on the standard port only, resolves each host itself, refuses
 * private, internal and metadata addresses, and connects to the very address
 * it checked, so a page can neither reach the network it runs on nor rebind a
 * name between the check and the connection. Plain HTTP is refused: a page
 * read over HTTPS upgrades its own requests, and a tunnel carries one host.
 */
import { connect, createServer, type Server, type Socket } from 'node:net'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'

const HEADER_LIMIT = 8 * 1024
const CONNECT_TIMEOUT_MS = 10_000

export interface GuardProxy {
  port: number
  /** Hosts refused so far, for the read's report. */
  refused: Set<string>
  close: () => Promise<void>
}

/** The host and port a CONNECT request names, or null when it names anything else. */
export function tunnelTarget(head: string): { host: string; port: number } | null {
  const line = head.slice(0, head.indexOf('\r\n'))
  const m = /^CONNECT (\[[0-9a-f:.]+\]|[^\s:]+):(\d+) HTTP\/1\.[01]$/i.exec(line)
  if (!m) return null
  return { host: m[1]!.replace(/^\[|\]$/g, ''), port: Number(m[2]) }
}

/** The address a host may be reached at: public, on the secure port, or null. */
export async function allowedAddress(
  host: string,
  port: number,
  securePort = 443
): Promise<{ address: string; family: 4 | 6 } | null> {
  if (port !== securePort) return null
  if (/(^|\.)(localhost|local|internal|localdomain|home|lan|intranet)$/i.test(host)) return null
  const name = host.includes(':') ? `[${host}]` : host
  const safety = await checkUrlSafety(`https://${name}/`)
  return safety.safe ? { address: safety.address, family: safety.family } : null
}

/** `securePort` is the one port tunnels may open, 443 outside tests. */
export function startGuardProxy({ securePort = 443 } = {}): Promise<GuardProxy> {
  const refused = new Set<string>()
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    client.on('error', () => client.destroy())
    let head = ''
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1')
      if (!head.includes('\r\n\r\n')) {
        if (head.length > HEADER_LIMIT) client.destroy()
        return
      }
      client.off('data', onData)
      client.pause()
      void open(client, head)
    }
    client.on('data', onData)
  })

  async function open(client: Socket, head: string) {
    const target = tunnelTarget(head)
    const allowed = target && (await allowedAddress(target.host, target.port, securePort))
    if (!target || !allowed) {
      if (target) refused.add(target.host)
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = connect({
      host: allowed.address,
      family: allowed.family,
      port: target.port,
      timeout: CONNECT_TIMEOUT_MS,
    })
    sockets.add(upstream)
    upstream.on('close', () => {
      sockets.delete(upstream)
      client.destroy()
    })
    upstream.on('error', () => upstream.destroy())
    upstream.on('timeout', () => upstream.destroy())
    upstream.once('connect', () => {
      upstream.setTimeout(0)
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      client.pipe(upstream)
      upstream.pipe(client)
      client.resume()
    })
    client.on('close', () => upstream.destroy())
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('no proxy port'))
      resolve({
        port: address.port,
        refused,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}
