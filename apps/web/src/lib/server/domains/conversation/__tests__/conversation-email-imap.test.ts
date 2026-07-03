/**
 * IMAP poller core: env config gating, the fetch/ingest/mark-seen loop with
 * per-message error isolation, and the two response parsers. The socket layer
 * is not exercised here — pollOnce runs against a fake client.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  readImapConfig,
  pollOnce,
  parseSearchUids,
  parseFetchLiteral,
  type ImapClient,
  type RawImapMessage,
} from '../conversation.email-imap'
import type { ParsedInboundEmail } from '../conversation.email-inbound'
import type { IngestInboundResult } from '../conversation.email-inbound.service'

describe('readImapConfig', () => {
  it('returns null unless the IMAP provider is explicitly selected', () => {
    expect(readImapConfig({})).toBeNull()
    expect(readImapConfig({ IMAP_HOST: 'h', IMAP_USER: 'u', IMAP_PASSWORD: 'p' })).toBeNull()
    expect(readImapConfig({ EMAIL_INBOUND_PROVIDER: 'resend' })).toBeNull()
  })

  it('reads discrete fields (TLS on by default, port derived)', () => {
    expect(
      readImapConfig({
        EMAIL_INBOUND_PROVIDER: 'imap',
        IMAP_HOST: 'imap.example.com',
        IMAP_USER: 'support@example.com',
        IMAP_PASSWORD: 'secret',
      })
    ).toEqual({
      host: 'imap.example.com',
      port: 993,
      user: 'support@example.com',
      password: 'secret',
      tls: true,
      mailbox: 'INBOX',
    })
  })

  it('honors IMAP_TLS=false (plaintext port 143) and a custom mailbox', () => {
    const config = readImapConfig({
      EMAIL_INBOUND_PROVIDER: 'imap',
      IMAP_HOST: 'h',
      IMAP_USER: 'u',
      IMAP_PASSWORD: 'p',
      IMAP_TLS: 'false',
      IMAP_MAILBOX: 'Support',
    })
    expect(config).toMatchObject({ tls: false, port: 143, mailbox: 'Support' })
  })

  it('returns null when credentials are incomplete', () => {
    expect(
      readImapConfig({ EMAIL_INBOUND_PROVIDER: 'imap', IMAP_HOST: 'h', IMAP_USER: 'u' })
    ).toBeNull()
  })
})

/** A fake mailbox: raw messages in, mark-seen calls recorded. */
function fakeClient(messages: RawImapMessage[]): ImapClient & { seen: number[]; closed: boolean } {
  const seen: number[] = []
  return {
    seen,
    closed: false,
    fetchUnseen: async () => messages,
    markSeen: async (uid: number) => {
      seen.push(uid)
    },
    close: async function (this: { closed: boolean }) {
      this.closed = true
    },
  }
}

const rawWithBody = (body: string) =>
  ['From: jane@example.com', 'To: reply+x@d', 'Message-ID: <m@x>', '', body].join('\r\n')

describe('pollOnce', () => {
  it('ingests each unseen message and marks it seen', async () => {
    const client = fakeClient([
      { uid: 1, raw: rawWithBody('one') },
      { uid: 2, raw: rawWithBody('two') },
    ])
    const ingest = vi.fn(
      async (): Promise<IngestInboundResult> => ({
        status: 'ingested',
        conversationId: 'conversation_x' as never,
      })
    )

    const result = await pollOnce(client, ingest)

    expect(result).toEqual({ fetched: 2, ingested: 2, failed: 0 })
    expect(ingest).toHaveBeenCalledTimes(2)
    expect(client.seen).toEqual([1, 2])
  })

  it('marks a routable-but-dropped message seen so it is not reprocessed', async () => {
    const client = fakeClient([{ uid: 5, raw: rawWithBody('spam') }])
    const ingest = async (): Promise<IngestInboundResult> => ({ status: 'suppressed' })

    const result = await pollOnce(client, ingest)

    expect(result).toEqual({ fetched: 1, ingested: 0, failed: 0 })
    expect(client.seen).toEqual([5])
  })

  it('leaves a message unseen (for retry) when ingest throws, and isolates it', async () => {
    const client = fakeClient([
      { uid: 1, raw: rawWithBody('boom') },
      { uid: 2, raw: rawWithBody('ok') },
    ])
    const ingest = vi
      .fn<() => Promise<IngestInboundResult>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ status: 'ingested', conversationId: 'conversation_x' as never })

    const result = await pollOnce(client, ingest)

    expect(result).toEqual({ fetched: 2, ingested: 1, failed: 1 })
    // uid 1 failed and stays unseen; uid 2 processed and marked.
    expect(client.seen).toEqual([2])
  })

  it('passes the parsed message (not the raw) to ingest', async () => {
    const client = fakeClient([{ uid: 1, raw: rawWithBody('hello there') }])
    let received: ParsedInboundEmail | undefined
    await pollOnce(client, async (parsed) => {
      received = parsed
      return { status: 'ingested', conversationId: 'conversation_x' as never }
    })
    expect(received?.from).toBe('jane@example.com')
    expect(received?.text).toBe('hello there')
  })
})

describe('parseSearchUids', () => {
  it('reads uids from an untagged SEARCH response', () => {
    expect(parseSearchUids('* SEARCH 1 4 9\r\nA1 OK done\r\n')).toEqual([1, 4, 9])
  })
  it('returns [] for an empty search', () => {
    expect(parseSearchUids('* SEARCH\r\nA1 OK done\r\n')).toEqual([])
  })
})

describe('parseFetchLiteral', () => {
  it('extracts exactly the declared literal length (CRLFs in the body are safe)', () => {
    const body = 'Subject: hi\r\n\r\nline one\r\nline two'
    const response = `* 1 FETCH (BODY[] {${body.length}}\r\n${body})\r\nA2 OK done\r\n`
    expect(parseFetchLiteral(response)).toBe(body)
  })
  it('returns null when there is no literal', () => {
    expect(parseFetchLiteral('* 1 FETCH (FLAGS (\\Seen))\r\nA2 OK done\r\n')).toBeNull()
  })
})
