/**
 * IMAP inbound (Layer 1 for self-hosters): poll a mailbox over IMAP, hand each
 * unseen message to the shared ingest core, and mark it seen. No IMAP or
 * mail-parsing dependency is available, so this speaks just enough of the
 * protocol (LOGIN / SELECT / UID SEARCH / UID FETCH / UID STORE) to pull raw
 * RFC822 messages, which `parseRawEmail` normalizes.
 *
 * The orchestration (`pollOnce`) is decoupled from the socket (`ImapClient`) so
 * the fetch/ingest/mark-seen loop and its per-message error isolation are
 * unit-tested with a fake client; the socket implementation is thin Layer-1
 * glue.
 */
import { connect as tlsConnect } from 'node:tls'
import { connect as netConnect } from 'node:net'
import type { Socket } from 'node:net'
import { logger } from '@/lib/server/logger'
import { parseRawEmail, type ParsedInboundEmail } from './conversation.email-inbound'
import type { IngestInboundResult } from './conversation.email-inbound.service'

const log = logger.child({ component: 'conversation-email-imap' })

type EnvLike = Record<string, string | undefined>

export interface ImapConfig {
  host: string
  port: number
  user: string
  password: string
  tls: boolean
  mailbox: string
}

/** One fetched message: its IMAP UID and the raw RFC822 bytes as text. */
export interface RawImapMessage {
  uid: number
  raw: string
}

/** The mailbox operations the poller needs. Implemented over a socket in
 *  production, faked in tests. */
export interface ImapClient {
  fetchUnseen(): Promise<RawImapMessage[]>
  markSeen(uid: number): Promise<void>
  close(): Promise<void>
}

/**
 * Read IMAP poller config from env. Returns null (so the worker no-ops without
 * connecting) unless the IMAP inbound provider is explicitly selected and the
 * connection is fully specified via the discrete IMAP_HOST/PORT/USER/PASSWORD/TLS
 * fields.
 */
export function readImapConfig(env: EnvLike = process.env): ImapConfig | null {
  if ((env.EMAIL_INBOUND_PROVIDER ?? '').toLowerCase() !== 'imap') return null

  const host = env.IMAP_HOST
  const user = env.IMAP_USER
  const password = env.IMAP_PASSWORD
  if (!host || !user || !password) return null
  // TLS on unless explicitly disabled.
  const tls = (env.IMAP_TLS ?? 'true').toLowerCase() !== 'false'
  return {
    host,
    port: env.IMAP_PORT ? Number(env.IMAP_PORT) : tls ? 993 : 143,
    user,
    password,
    tls,
    mailbox: env.IMAP_MAILBOX || 'INBOX',
  }
}

/**
 * Fetch unseen messages, ingest each through the shared core, and mark seen.
 * Per-message isolation: a message whose ingest THROWS (a transient failure) is
 * left unseen for the next poll, while a routable-but-dropped message (spam,
 * unroutable, suppressed) is marked seen so it isn't reprocessed forever.
 */
export async function pollOnce(
  client: ImapClient,
  ingest: (parsed: ParsedInboundEmail) => Promise<IngestInboundResult>
): Promise<{ fetched: number; ingested: number; failed: number }> {
  const messages = await client.fetchUnseen()
  let ingested = 0
  let failed = 0
  for (const message of messages) {
    try {
      const result = await ingest(parseRawEmail(message.raw))
      if (result.status === 'ingested' || result.status === 'ingested_ticket') ingested++
      await client.markSeen(message.uid)
    } catch (err) {
      failed++
      log.warn({ err, uid: message.uid }, 'imap message ingest failed; left unseen for retry')
    }
  }
  return { fetched: messages.length, ingested, failed }
}

// ============================================================================
// Minimal socket IMAP client. Thin Layer-1 glue; the tested surface is pollOnce.
// ============================================================================

const CONNECT_TIMEOUT_MS = 10_000
const RESPONSE_TIMEOUT_MS = 20_000
// Bound the work per poll; leftover unseen mail is picked up next tick.
const MAX_UIDS_PER_POLL = 50
// Re-scan window overlap so a completion tag split across two chunks still matches.
const SEND_SCAN_OVERLAP = 16

/** A tiny tagged-command IMAP session over a (TLS) socket. */
class SocketImapClient implements ImapClient {
  private tagSeq = 0
  private buffer = ''
  private constructor(
    private readonly socket: Socket,
    private readonly config: ImapConfig
  ) {}

  static async connect(config: ImapConfig): Promise<SocketImapClient> {
    const socket: Socket = config.tls
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
      : netConnect({ host: config.host, port: config.port })
    socket.setEncoding('utf8')
    const client = new SocketImapClient(socket, config)
    await client.waitConnected()
    await client.exec(`LOGIN ${quote(config.user)} ${quote(config.password)}`)
    // SELECT (not EXAMINE) — STORE \Seen needs write access.
    await client.exec(`SELECT ${quote(config.mailbox)}`)
    return client
  }

  async fetchUnseen(): Promise<RawImapMessage[]> {
    const searchTag = this.nextTag()
    const searchResp = await this.send(searchTag, 'UID SEARCH UNSEEN')
    // Cap the batch per poll; the remainder stays unseen for the next tick.
    const uids = parseSearchUids(searchResp).slice(0, MAX_UIDS_PER_POLL)
    const messages: RawImapMessage[] = []
    for (const uid of uids) {
      const tag = this.nextTag()
      const resp = await this.send(tag, `UID FETCH ${uid} (BODY.PEEK[])`)
      const raw = parseFetchLiteral(resp)
      if (raw !== null) messages.push({ uid, raw })
    }
    return messages
  }

  async markSeen(uid: number): Promise<void> {
    await this.exec(`UID STORE ${uid} +FLAGS (\\Seen)`)
  }

  async close(): Promise<void> {
    try {
      await this.exec('LOGOUT')
    } catch {
      // best effort
    } finally {
      this.socket.destroy()
    }
  }

  private nextTag(): string {
    return `A${++this.tagSeq}`
  }

  private async exec(command: string): Promise<string> {
    return this.send(this.nextTag(), command)
  }

  private waitConnected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const timer = setTimeout(() => onError(new Error('imap connect timeout')), CONNECT_TIMEOUT_MS)
      const onData = (chunk: string) => {
        this.buffer += chunk
        // Server greeting is an untagged `* OK ...` line. A PREAUTH greeting is
        // not accepted: this client always issues LOGIN, so a pre-authenticated
        // session is unexpected and better surfaced as a connect failure.
        if (/^\*\s+OK/m.test(this.buffer)) {
          this.buffer = ''
          cleanup()
          resolve()
        }
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.socket.off('error', onError)
        this.socket.off('data', onData)
      }
      this.socket.on('error', onError)
      this.socket.on('data', onData)
    })
  }

  /** Send a tagged command and resolve with the full response text once the
   *  tagged completion line (`<tag> OK|NO|BAD`) arrives. */
  private send(tag: string, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.buffer = ''
      // The completion line always trails the response (after any large FETCH
      // literal), so scan only the newly appended tail on each chunk instead of
      // the whole growing buffer.
      let scanned = 0
      const completion = new RegExp(`^${tag} (OK|NO|BAD)([^\\r\\n]*)`, 'm')
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const timer = setTimeout(
        () => onError(new Error(`imap response timeout for ${command.split(' ')[0]}`)),
        RESPONSE_TIMEOUT_MS
      )
      const onData = (chunk: string) => {
        this.buffer += chunk
        // Back up a small overlap (so a tag split across chunks is recovered) and
        // align to a line start so `^` only matches real line beginnings.
        const back = Math.max(0, scanned - SEND_SCAN_OVERLAP)
        const nl = this.buffer.lastIndexOf('\n', back)
        const from = nl === -1 ? 0 : nl + 1
        const match = completion.exec(this.buffer.slice(from))
        scanned = this.buffer.length
        if (!match) return
        cleanup()
        if (match[1] === 'OK') resolve(this.buffer)
        else reject(new Error(`imap ${match[1]} for ${command.split(' ')[0]}:${match[2]}`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.socket.off('error', onError)
        this.socket.off('data', onData)
      }
      this.socket.on('error', onError)
      this.socket.on('data', onData)
      this.socket.write(`${tag} ${command}\r\n`)
    })
  }
}

/** Connect + authenticate a live IMAP client. */
export function createImapClient(config: ImapConfig): Promise<ImapClient> {
  return SocketImapClient.connect(config)
}

/** Quote an IMAP string argument (astring), escaping `\` and `"`. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Parse UID numbers from an `* SEARCH 1 2 3` untagged response. */
export function parseSearchUids(response: string): number[] {
  const match = /^\*\s+SEARCH([^\r\n]*)/m.exec(response)
  if (!match) return []
  return match[1]
    .trim()
    .split(/\s+/)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/** Extract the RFC822 payload from a `UID FETCH ... {N}\r\n<N octets>` response,
 *  using the declared literal length so the body's own CRLFs are safe. */
export function parseFetchLiteral(response: string): string | null {
  const brace = response.indexOf('{')
  if (brace === -1) return null
  const close = response.indexOf('}', brace)
  if (close === -1) return null
  const length = Number(response.slice(brace + 1, close))
  if (!Number.isInteger(length) || length < 0) return null
  const start = response.indexOf('\n', close)
  if (start === -1) return null
  return response.slice(start + 1, start + 1 + length)
}
