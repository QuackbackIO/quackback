/**
 * The webhook sink: an https server on the one named host the app may deliver
 * webhooks to in tests (`webhook-sink.localhost`, see
 * src/lib/server/e2e-harness/webhook-sink.ts), plus a plain-http control port on
 * 127.0.0.1 that tests read deliveries from.
 *
 * Webhook URL:   https://webhook-sink.localhost:<port>/hooks/<channel>
 *   Every POST is recorded under <channel>. A test uses its own channel name,
 *   so parallel tests never see each other's deliveries.
 *
 * Control API (http://127.0.0.1:<control port>, via e2e/support/webhook-sink-client.ts):
 *   GET  /__sink/deliveries?channel=...    recorded deliveries, oldest first
 *   POST /__sink/channels/<channel>        { "status": 500 } answer that channel with a status
 *   GET  /__sink/health
 *
 * Run: bun e2e/support/stand-ins/webhook-sink.ts   (ports from support.env)
 */
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { readFileSync } from 'node:fs'
import { supportEnv } from '../env'
import { ensureSinkCertificate } from './tls'

export interface SinkDelivery {
  seq: number
  at: string
  channel: string
  method: string
  path: string
  headers: Record<string, string>
  body: string
  /** The body parsed as JSON, or null. */
  json: unknown
  /** The status the sink answered with. */
  status: number
}

const MAX_RECORDED = 2_000

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function flatHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = v.join(', ')
  }
  return out
}

if (import.meta.main) {
  const env = supportEnv()
  ensureSinkCertificate(env.sinkCertPath, env.sinkKeyPath)

  const deliveries: SinkDelivery[] = []
  const channelStatus = new Map<string, number>()
  let seq = 0

  const sink = createHttpsServer(
    { key: readFileSync(env.sinkKeyPath), cert: readFileSync(env.sinkCertPath) },
    async (req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      const match = /^\/hooks\/([A-Za-z0-9._-]+)/.exec(path)
      const body = await readBody(req)
      if (!match) {
        res.writeHead(404).end('not a sink path')
        return
      }
      const channel = match[1]
      const status = channelStatus.get(channel) ?? 200
      let json: unknown = null
      try {
        json = JSON.parse(body)
      } catch {
        json = null
      }
      deliveries.push({
        seq: ++seq,
        at: new Date().toISOString(),
        channel,
        method: req.method ?? 'POST',
        path,
        headers: flatHeaders(req),
        body,
        json,
        status,
      })
      if (deliveries.length > MAX_RECORDED) deliveries.splice(0, deliveries.length - MAX_RECORDED)
      res.writeHead(status, { 'content-type': 'text/plain' }).end(status < 300 ? 'ok' : 'nope')
    }
  )
  // Dual-stack: the name resolves to ::1 first on some machines, 127.0.0.1 on others.
  sink.listen({ port: env.sinkPort, host: '::', ipv6Only: false })

  const control = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, value: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    if (url.pathname === '/__sink/health') return send(200, { ok: true })
    if (url.pathname === '/__sink/deliveries' && req.method === 'GET') {
      const channel = url.searchParams.get('channel')
      return send(
        200,
        deliveries.filter((d) => !channel || d.channel === channel)
      )
    }
    const channelMatch = /^\/__sink\/channels\/([A-Za-z0-9._-]+)$/.exec(url.pathname)
    if (channelMatch && req.method === 'POST') {
      const { status } = JSON.parse((await readBody(req)) || '{}') as { status?: number }
      if (typeof status === 'number') channelStatus.set(channelMatch[1], status)
      else channelStatus.delete(channelMatch[1])
      return send(200, { ok: true })
    }
    return send(404, { error: 'unknown control path' })
  })
  control.listen(env.sinkControlPort, '127.0.0.1', () => {
    process.stdout.write(`webhook sink on ${env.sinkOrigin}, control on ${env.sinkControlUrl}\n`)
  })
}
