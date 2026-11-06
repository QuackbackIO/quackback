/**
 * TXT lookups read straight from the DNS wire format.
 *
 * ## Why this exists
 *
 * A TXT value longer than 255 bytes is published as one record made of several
 * strings, and every 2048-bit signing key is one. Node's `resolveTxt` returns it
 * as one record holding all of its strings. Bun's returns each string as a
 * record of its own (oven-sh/bun#44692; the fix, oven-sh/bun#45543, is not
 * released). Once flattened, the record boundaries are gone, and no rule applied
 * afterwards can tell one long record from several short ones in every case. So
 * a signing key read on Bun looks cut short at 255 bytes, and a domain the mail
 * provider has verified stays pending here.
 *
 * Reading the answer ourselves keeps each record's strings exactly as the zone
 * published them, on either runtime. It also asks the nameserver every time,
 * rather than through Bun's resolver cache, which can hold an empty answer for
 * up to an hour after a record is published (oven-sh/bun#44777). When Bun ships
 * the fix, `resolveTxt` can go back to the runtime and this module can go.
 *
 * ## What it does
 *
 * One question (TXT, class IN, recursion desired, EDNS0 with room for a large
 * answer) to the system's nameservers in order, over UDP, and again over TCP
 * when the UDP answer comes back truncated. Each server is asked up to `tries`
 * times. Packets are encoded and decoded by `dns-packet`, which keeps each TXT
 * record's strings together.
 *
 * ## Forged answers
 *
 * An answer here can prove a workspace owns a domain, so a forged one must not
 * be accepted. Following RFC 5452 section 9.1, a reply is read only when it
 * comes from the nameserver the query was sent to, arrives at the port it was
 * sent from, carries the query's id, and answers the same question (name, type
 * and class). Every query uses a fresh socket, so the operating system picks a
 * new random source port, and an id drawn from a cryptographic generator over
 * the full 16-bit range. The UDP socket is connected to the nameserver, so the
 * operating system drops datagrams from any other address before they reach
 * us, and the sender is checked again on arrival.
 *
 * ## Failures
 *
 * Failures carry the codes Node uses, so `isNoAnswer` reads them the same way:
 * ENOTFOUND and ENODATA mean the zone said nothing is published; ESERVFAIL,
 * EREFUSED, ETIMEOUT and the rest mean we could not ask.
 */
import { randomInt } from 'node:crypto'
import { createSocket, type RemoteInfo } from 'node:dgram'
import { getServers } from 'node:dns'
import { connect, isIPv6 } from 'node:net'
import * as dnsPacket from 'dns-packet'

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

/**
 * The name as it is asked and compared: without a trailing dot, lower-cased.
 * EBADNAME for one that cannot be sent as it is: an empty or over-long label, a
 * name over 253 characters, or anything but printable ASCII (a non-ASCII name
 * must be IDNA-encoded by the caller).
 */
function canonicalName(host: string): string {
  const name = (host.endsWith('.') ? host.slice(0, -1) : host).toLowerCase()
  const labels = name.split('.')
  const valid =
    name.length > 0 &&
    name.length <= 253 &&
    labels.every((label) => label.length > 0 && label.length <= 63) &&
    /^[\x21-\x7e]+$/.test(name)
  if (!valid) throw new DnsQueryError('EBADNAME', host)
  return name
}

/** A TXT query for `name` with message id `id`, carrying an EDNS0 OPT record. */
export function encodeTxtQuery(id: number, name: string): Buffer {
  return dnsPacket.encode({
    type: 'query',
    id,
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [{ type: 'TXT', class: 'IN', name }],
    additionals: [
      {
        type: 'OPT',
        name: '.',
        udpPayloadSize: EDNS_UDP_PAYLOAD,
        extendedRcode: 0,
        ednsVersion: 0,
        flags: 0,
        flag_do: false,
        options: [],
      },
    ],
  })
}

interface ParsedAnswer {
  truncated: boolean
  rcode: number
  records: string[][]
}

/**
 * The answer to the query `id` for `name`, or null when the message is not that
 * answer: unreadable, not a response, another id, or another question.
 */
function readAnswer(msg: Buffer, id: number, name: string): ParsedAnswer | null {
  let packet: dnsPacket.DecodedPacket
  try {
    packet = dnsPacket.decode(msg)
  } catch {
    return null
  }
  if (!packet.flag_qr || packet.id !== id) return null
  const question = packet.questions?.[0]
  if (
    packet.questions?.length !== 1 ||
    question?.type !== 'TXT' ||
    question.class !== 'IN' ||
    question.name.toLowerCase() !== name
  ) {
    return null
  }
  const records: string[][] = []
  for (const answer of packet.answers ?? []) {
    if (answer.type !== 'TXT' || (answer.class ?? 'IN') !== 'IN') continue
    const data = Array.isArray(answer.data) ? answer.data : [answer.data]
    records.push(data.map((s) => (typeof s === 'string' ? s : s.toString('utf8'))))
  }
  return { truncated: packet.flag_tc, rcode: (packet.flags ?? 0) & 0x0f, records }
}

/** Whether a datagram came from the nameserver it was sent to. */
function fromServer(rinfo: RemoteInfo, server: NameServer): boolean {
  if (rinfo.port !== server.port) return false
  // Compare addresses in one spelling: an IPv6 address can be written several ways.
  const spell = (address: string) =>
    isIPv6(address) ? new URL(`http://[${address}]/`).hostname : address
  return spell(rinfo.address) === spell(server.address)
}

/** One UDP exchange on a socket connected to the nameserver. */
function overUdp(server: NameServer, query: Buffer, id: number, name: string, timeoutMs: number) {
  return new Promise<ParsedAnswer>((resolve, reject) => {
    const socket = createSocket(isIPv6(server.address) ? 'udp6' : 'udp4')
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('ETIMEOUT'))), timeoutMs)
    socket.on('error', (err) => done(() => reject(err)))
    socket.on('message', (msg, rinfo) => {
      if (!fromServer(rinfo, server)) return
      const answer = readAnswer(msg, id, name)
      if (answer) done(() => resolve(answer))
    })
    socket.connect(server.port, server.address, () => {
      socket.send(query, (err) => {
        if (err) done(() => reject(err))
      })
    })
  })
}

/** One TCP exchange, for an answer too large for UDP. */
function overTcp(server: NameServer, query: Buffer, id: number, name: string, timeoutMs: number) {
  return new Promise<ParsedAnswer>((resolve, reject) => {
    const conn = connect({ host: server.address, port: server.port })
    let buf = Buffer.alloc(0)
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
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
      const answer = readAnswer(buf.subarray(2, 2 + buf.readUInt16BE(0)), id, name)
      done(() => (answer ? resolve(answer) : reject(new Error('EBADRESP'))))
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
  const name = canonicalName(host)
  const servers = opts.servers ?? getServers().map(parseServer)
  if (servers.length === 0) throw new DnsQueryError('ECONNREFUSED', host)
  let lastCode = 'ETIMEOUT'
  for (const server of servers) {
    for (let attempt = 0; attempt < Math.max(1, opts.tries); attempt++) {
      const id = randomInt(0, 0x10000)
      const query = encodeTxtQuery(id, name)
      let answer: ParsedAnswer
      try {
        answer = await overUdp(server, query, id, name, opts.timeoutMs)
        if (answer.truncated) answer = await overTcp(server, query, id, name, opts.timeoutMs)
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
