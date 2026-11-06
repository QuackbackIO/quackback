/**
 * TXT lookups read straight from the DNS wire format.
 *
 * ## Why this exists
 *
 * A TXT value longer than 255 bytes is published as one record made of several
 * strings, and every 2048-bit signing key is one. Node's `resolveTxt` returns it
 * as one record holding all of its strings. Bun's (oven-sh/bun#44692) returns
 * each string as a record of its own, and once the strings are flattened the
 * record boundaries are gone: no rule applied afterwards can tell one long
 * record from several short ones in every case. So a signing key read on Bun
 * looks cut short at 255 bytes and a domain the mail provider has verified
 * stays pending here.
 *
 * Reading the answer ourselves keeps each record's strings exactly as the zone
 * published them, on either runtime. It also asks the nameserver every time,
 * rather than through a runtime cache that can hold an empty answer for up to
 * an hour after a record is published (oven-sh/bun#44777).
 *
 * ## What it does
 *
 * One question (TXT, class IN, recursion desired, EDNS0 with room for a large
 * answer) to the system's nameservers in order, over UDP, and again over TCP
 * when the UDP answer comes back truncated. Each server is asked up to `tries`
 * times. Failures carry the codes Node uses, so `isNoAnswer` reads them the
 * same way: ENOTFOUND and ENODATA mean the zone said nothing is published;
 * ESERVFAIL, EREFUSED, ETIMEOUT and the rest mean we could not ask.
 */
import { createSocket } from 'node:dgram'
import { getServers } from 'node:dns'
import { connect, isIPv6 } from 'node:net'
import { randomInt } from 'node:crypto'

export interface NameServer {
  address: string
  port: number
}

export interface TxtQueryOptions {
  /** How long one try at one server may take. */
  timeoutMs: number
  /** How many times each server is asked before moving on. */
  tries: number
  /** The nameservers to ask; the system's own when omitted. */
  servers?: NameServer[]
}

const TYPE_TXT = 16
const TYPE_OPT = 41
const CLASS_IN = 1
const EDNS_UDP_PAYLOAD = 1232
const RCODE_NOERROR = 0
const RCODE_SERVFAIL = 2
const RCODE_NXDOMAIN = 3
const RCODE_REFUSED = 5

/** A lookup failure, coded the way Node's resolver codes the same outcome. */
class DnsQueryError extends Error {
  readonly code: string

  constructor(code: string, host: string) {
    super(`queryTxt ${code} ${host}`)
    this.name = 'DnsQueryError'
    this.code = code
  }
}

/** A nameserver as `getServers()` lists it: `a.b.c.d`, `a.b.c.d:p`, `v6` or `[v6]:p`. */
export function parseServer(value: string): NameServer {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
  if (bracketed) return { address: bracketed[1], port: Number(bracketed[2] ?? 53) }
  if (isIPv6(value)) return { address: value, port: 53 }
  const [address, port] = value.split(':')
  return { address, port: Number(port ?? 53) }
}

/** The name as wire labels, or EBADNAME for one that cannot be sent as it is. */
function encodeName(host: string): Buffer {
  const name = host.endsWith('.') ? host.slice(0, -1) : host
  const labels = name.split('.')
  const parts: Buffer[] = []
  for (const label of labels) {
    const bytes = Buffer.from(label, 'latin1')
    // Printable ASCII only: a non-ASCII name must be IDNA-encoded by the caller.
    if (bytes.length === 0 || bytes.length > 63 || !/^[\x21-\x7e]+$/.test(label)) {
      throw new DnsQueryError('EBADNAME', host)
    }
    parts.push(Buffer.from([bytes.length]), bytes)
  }
  const encoded = Buffer.concat([...parts, Buffer.from([0])])
  if (encoded.length > 255) throw new DnsQueryError('EBADNAME', host)
  return encoded
}

/** A TXT query for `host` with message id `id`, carrying an EDNS0 OPT record. */
export function encodeTxtQuery(id: number, host: string): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(id, 0)
  header.writeUInt16BE(0x0100, 2) // recursion desired
  header.writeUInt16BE(1, 4) // one question
  header.writeUInt16BE(1, 10) // one additional record: OPT
  const question = Buffer.alloc(4)
  question.writeUInt16BE(TYPE_TXT, 0)
  question.writeUInt16BE(CLASS_IN, 2)
  const opt = Buffer.alloc(11)
  opt.writeUInt8(0, 0) // root name
  opt.writeUInt16BE(TYPE_OPT, 1)
  opt.writeUInt16BE(EDNS_UDP_PAYLOAD, 3)
  // extended rcode, version, flags (ttl) and rdlength stay zero
  return Buffer.concat([header, encodeName(host), question, opt])
}

interface ParsedAnswer {
  truncated: boolean
  rcode: number
  records: string[][]
}

/** The offset just past a (possibly compressed) name starting at `off`. */
function skipName(msg: Buffer, off: number): number {
  for (;;) {
    if (off >= msg.length) throw new RangeError('name runs past the message')
    const len = msg[off]
    if (len === 0) return off + 1
    if ((len & 0xc0) === 0xc0) return off + 2 // a pointer ends the name
    off += len + 1
  }
}

/** The answer to query `id`, or null when the message is not that answer. */
function parseAnswer(msg: Buffer, id: number): ParsedAnswer | null {
  if (msg.length < 12 || msg.readUInt16BE(0) !== id) return null
  const flags = msg.readUInt16BE(2)
  if ((flags & 0x8000) === 0) return null // not a response
  const qdcount = msg.readUInt16BE(4)
  const ancount = msg.readUInt16BE(6)
  let off = 12
  for (let i = 0; i < qdcount; i++) off = skipName(msg, off) + 4
  const records: string[][] = []
  for (let i = 0; i < ancount; i++) {
    off = skipName(msg, off)
    if (off + 10 > msg.length) throw new RangeError('record header runs past the message')
    const type = msg.readUInt16BE(off)
    const klass = msg.readUInt16BE(off + 2)
    const rdlength = msg.readUInt16BE(off + 8)
    const start = off + 10
    const end = start + rdlength
    if (end > msg.length) throw new RangeError('record data runs past the message')
    if (type === TYPE_TXT && klass === CLASS_IN) {
      const strings: string[] = []
      let p = start
      while (p < end) {
        const len = msg[p]
        if (p + 1 + len > end) throw new RangeError('string runs past its record')
        strings.push(msg.toString('utf8', p + 1, p + 1 + len))
        p += 1 + len
      }
      records.push(strings)
    }
    off = end
  }
  return { truncated: (flags & 0x0200) !== 0, rcode: flags & 0x000f, records }
}

/** One UDP exchange; resolves with the first message that answers `id`. */
function overUdp(server: NameServer, query: Buffer, id: number, timeoutMs: number) {
  return new Promise<ParsedAnswer>((resolve, reject) => {
    const socket = createSocket(isIPv6(server.address) ? 'udp6' : 'udp4')
    const done = (fn: () => void) => {
      clearTimeout(timer)
      socket.close()
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('ETIMEOUT'))), timeoutMs)
    socket.on('error', (err) => done(() => reject(err)))
    socket.on('message', (msg) => {
      let parsed: ParsedAnswer | null
      try {
        parsed = parseAnswer(msg, id)
      } catch {
        return // a malformed packet is ignored like a stray one
      }
      if (parsed) done(() => resolve(parsed))
    })
    socket.send(query, server.port, server.address, (err) => {
      if (err) done(() => reject(err))
    })
  })
}

/** One TCP exchange, for an answer too large for UDP. */
function overTcp(server: NameServer, query: Buffer, id: number, timeoutMs: number) {
  return new Promise<ParsedAnswer>((resolve, reject) => {
    const conn = connect({ host: server.address, port: server.port })
    let buf = Buffer.alloc(0)
    const done = (fn: () => void) => {
      clearTimeout(timer)
      conn.destroy()
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('ETIMEOUT'))), timeoutMs)
    conn.on('error', (err) => done(() => reject(err)))
    conn.on('connect', () => {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(query.length)
      conn.write(Buffer.concat([len, query]))
    })
    conn.on('data', (chunk) => {
      buf = Buffer.concat([buf, Buffer.from(chunk)])
      if (buf.length < 2 || buf.length < 2 + buf.readUInt16BE(0)) return
      try {
        const parsed = parseAnswer(buf.subarray(2, 2 + buf.readUInt16BE(0)), id)
        done(() => (parsed ? resolve(parsed) : reject(new Error('EBADRESP'))))
      } catch {
        done(() => reject(new Error('EBADRESP')))
      }
    })
  })
}

/** The code a transport failure is reported under. */
function transportCode(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (message === 'ETIMEOUT' || message === 'EBADRESP') return message
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ECONNREFUSED'
}

/**
 * The TXT records at `host`, each as the list of strings it was published in.
 * Throws a coded error when there are none or the nameservers cannot be asked.
 */
export async function queryTxt(host: string, opts: TxtQueryOptions): Promise<string[][]> {
  const servers = opts.servers ?? getServers().map(parseServer)
  if (servers.length === 0) throw new DnsQueryError('ECONNREFUSED', host)
  // Encoded once, so a bad name fails before anything is sent.
  encodeName(host)
  let lastCode = 'ETIMEOUT'
  for (const server of servers) {
    for (let attempt = 0; attempt < Math.max(1, opts.tries); attempt++) {
      const id = randomInt(0, 0x10000)
      const query = encodeTxtQuery(id, host)
      let answer: ParsedAnswer
      try {
        answer = await overUdp(server, query, id, opts.timeoutMs)
        if (answer.truncated) answer = await overTcp(server, query, id, opts.timeoutMs)
      } catch (err) {
        lastCode = transportCode(err)
        continue
      }
      if (answer.rcode === RCODE_NXDOMAIN) throw new DnsQueryError('ENOTFOUND', host)
      if (answer.rcode === RCODE_NOERROR) {
        if (answer.records.length === 0) throw new DnsQueryError('ENODATA', host)
        return answer.records
      }
      // SERVFAIL, REFUSED and the rest say nothing about the record: next server.
      lastCode =
        answer.rcode === RCODE_SERVFAIL
          ? 'ESERVFAIL'
          : answer.rcode === RCODE_REFUSED
            ? 'EREFUSED'
            : 'EBADRESP'
      break
    }
  }
  throw new DnsQueryError(lastCode, host)
}
