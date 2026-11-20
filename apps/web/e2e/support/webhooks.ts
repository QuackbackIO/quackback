/**
 * Helpers for the webhook and background-job specs
 * (tests/support/webhooks.spec.ts, tests/support/jobs.spec.ts).
 *
 *   const api = await hooksApi(playwright, baseURL, people, marker)
 *   const hook = await subscribe(api, marker, ['message.created'])
 *   ... make something happen ...
 *   const [d] = await deliveriesOf(marker, 'message.created', conversationId)
 *   expectSigned(d, hook.secret)
 */
import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromUuid } from '@quackback/ids'
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { supportDb, pollFor } from './db'
import { supportEnv } from './env'
import { sink, type SinkDelivery } from './webhook-sink-client'
import { sendInboundEmail, supportInboxAddress } from './inbound-email'
import { createSupportApiKey } from '../utils/db-helpers'
import type { SeededPeople } from './people'
import { sessionCookieHeader } from './presence'
import type { SupportPersonName } from './people'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The header the app reads the client address from in the suite
 * (TRUSTED_CLIENT_IP_HEADER), so each test gets its own REST rate-limit
 * bucket instead of sharing loopback's 100 requests a minute.
 */
export const CLIENT_IP_HEADER = 'x-e2e-client-ip'

/** A stable private address per marker. */
export function clientIpFor(marker: string): string {
  const h = createHash('sha256').update(marker).digest()
  return `10.${h[0]}.${h[1]}.${(h[2] % 250) + 1}`
}

/** REST context authenticated with a fresh personal key of `person`. */
export async function hooksApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople,
  marker: string,
  person: SupportPersonName = 'admin'
): Promise<APIRequestContext> {
  const key = createSupportApiKey(people.people[person].email, 'personal')
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${key}`,
      [CLIENT_IP_HEADER]: clientIpFor(marker),
      // A test idles while it waits for deliveries; a pooled connection the
      // server has since closed would fail the next call with ECONNRESET.
      connection: 'close',
    },
  })
}

export interface Hook {
  id: string
  secret: string
}

/** Create a webhook on the sink channel `channel` for `events`. */
export async function subscribe(
  api: APIRequestContext,
  channel: string,
  events: string[]
): Promise<Hook> {
  const res = await api.post('/api/v1/webhooks', { data: { url: sink.url(channel), events } })
  expect(res.status(), await res.text()).toBe(201)
  const { data } = (await res.json()) as { data: Hook }
  return data
}

export async function unsubscribe(api: APIRequestContext, hook: Hook | undefined): Promise<void> {
  if (hook) await api.delete(`/api/v1/webhooks/${hook.id}`)
}

/** Deliveries of `type` on `channel` whose body names `entityId`. */
export function deliveriesOf(
  channel: string,
  type: string,
  entityId: string,
  opts: { count?: number; timeoutMs?: number } = {}
): Promise<SinkDelivery[]> {
  return sink.waitForDeliveries(channel, {
    count: opts.count,
    timeoutMs: opts.timeoutMs,
    where: (d) => d.headers['x-quackback-event'] === type && d.body.includes(entityId),
  })
}

/** The parsed webhook body. */
export function bodyOf<T = Record<string, unknown>>(
  d: SinkDelivery
): { id: string; type: string; createdAt: string; data: T } {
  return JSON.parse(d.body)
}

/** The delivery is signed with `secret` over "<timestamp>.<raw body>". */
export function expectSigned(d: SinkDelivery, secret: string): void {
  const ts = d.headers['x-quackback-timestamp']
  expect(ts, 'timestamp header').toMatch(/^\d+$/)
  const expected = createHmac('sha256', secret).update(`${ts}.${d.body}`).digest('hex')
  expect(d.headers['x-quackback-signature']).toBe(`sha256=${expected}`)
}

/** Open an email conversation from `from`; returns its TypeID. */
export async function emailConversation(
  request: APIRequestContext,
  from: string,
  marker: string,
  text = `Hello ${marker}`
): Promise<string> {
  const messageId = `<${marker}-open@customers.example>`
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject: `Help ${marker}`,
    text,
    messageId,
  })
  expect(res.status(), await res.text()).toBe(200)
  const sql = supportDb()
  const row = await pollFor('the email conversation', async () => {
    const [r] = await sql`SELECT c.id FROM conversation_messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.metadata ->> 'emailMessageId' LIKE ${`%${marker}-open@customers.example%`} LIMIT 1`
    return r ?? null
  })
  return fromUuid('conversation', row.id as string)
}

/** Run e2e/scripts/support-hook-ops.ts with one operation. */
export function hookOp<T = Record<string, unknown>>(args: Record<string, unknown>): T {
  const envFile = process.env.E2E_ENV_FILE ?? '../../.env'
  try {
    const out = execFileSync(
      'bun',
      [
        `--env-file=${envFile}`,
        resolve(here, '../scripts/support-hook-ops.ts'),
        JSON.stringify(args),
      ],
      {
        encoding: 'utf-8',
        cwd: resolve(here, '../..'),
        env: { ...process.env, LOG_LEVEL: 'error' },
      }
    )
    const line = out.split('\n').find((l) => l.startsWith('__RESULT__'))
    if (!line) throw new Error(`no result in output: ${out.slice(0, 500)}`)
    return JSON.parse(line.slice('__RESULT__'.length)) as T
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`support-hook-ops ${String(args.op)} failed: ${err.stderr || err.message}`, {
      cause: error,
    })
  }
}

/** Create a workflow (live when asked); waits out a cold "any live?" cache. */
export async function createWorkflow(
  input: Record<string, unknown>,
  live = true
): Promise<{ id: string; cleanup: () => void }> {
  const out = hookOp<{ id: string; coldCache: boolean }>({ op: 'workflow-create', input, live })
  if (out.coldCache) await new Promise((r) => setTimeout(r, 31_000))
  return { id: out.id, cleanup: () => hookOp({ op: 'workflow-delete', id: out.id }) }
}

/** A frame from the realtime stream. */
export interface StreamFrame {
  event: string | null
  data: unknown
}

/**
 * Listen on /api/chat/stream with `query` (e.g. `scope=inbox`,
 * `conversationId=...`), as a person (cookie) or with a stream token.
 */
export async function openStream(
  query: string,
  auth: { person: SupportPersonName } | { token: string }
): Promise<{ frames: StreamFrame[]; close: () => void; ready: Promise<void> }> {
  const controller = new AbortController()
  const frames: StreamFrame[] = []
  const url = `${supportEnv().baseUrl}/api/chat/stream?${query}${
    'token' in auth ? `&token=${encodeURIComponent(auth.token)}` : ''
  }`
  const res = await fetch(url, {
    headers: {
      accept: 'text/event-stream',
      ...('person' in auth ? { cookie: sessionCookieHeader(auth.person) } : {}),
    },
    signal: controller.signal,
  })
  if (!res.ok || !res.body) {
    controller.abort()
    throw new Error(`stream ${query} answered ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((r) => (resolveReady = r))
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resolveReady()
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          let event: string | null = null
          const data: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
          }
          if (data.length === 0) continue
          try {
            frames.push({ event, data: JSON.parse(data.join('\n')) })
          } catch {
            frames.push({ event, data: data.join('\n') })
          }
        }
      }
    } catch {
      // aborted
    }
  })()
  return { frames, close: () => controller.abort(), ready }
}
