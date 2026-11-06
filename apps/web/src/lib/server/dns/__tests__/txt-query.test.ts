/**
 * TXT lookups read straight from the wire, so a long record keeps its strings
 * together whatever the runtime. Exercised against a real nameserver on
 * localhost that answers with hand-built packets, over UDP and TCP.
 */
import { createSocket, type Socket } from 'node:dgram'
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isNoAnswer } from '../lookup-outcome'
import { encodeTxtQuery, parseServer, queryTxt } from '../txt-query'

// ---------------------------------------------------------------------------
// A tiny authoritative-looking nameserver
// ---------------------------------------------------------------------------

type Rr = { type: number; rdata: Buffer }

const txtRdata = (...strings: string[]): Buffer =>
  Buffer.concat(
    strings.map((s) => {
      const bytes = Buffer.from(s, 'utf8')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
  )
const txt = (...strings: string[]): Rr => ({ type: 16, rdata: txtRdata(...strings) })

/** The question section of a query: from byte 12 to the end of QTYPE/QCLASS. */
function questionOf(query: Buffer): Buffer {
  let off = 12
  while (query[off] !== 0) off += query[off] + 1
  return query.subarray(12, off + 5)
}

/** A response to `query`, answers owned by the question name (pointer 0xC00C). */
function respond(
  query: Buffer,
  answers: Rr[],
  opts: { rcode?: number; tc?: boolean; id?: number } = {}
): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(opts.id ?? query.readUInt16BE(0), 0)
  header.writeUInt16BE(0x8180 | (opts.tc ? 0x0200 : 0) | (opts.rcode ?? 0), 2)
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(answers.length, 6)
  const rrs = answers.map((rr) => {
    const fixed = Buffer.alloc(12)
    fixed.writeUInt16BE(0xc00c, 0)
    fixed.writeUInt16BE(rr.type, 2)
    fixed.writeUInt16BE(1, 4)
    fixed.writeUInt32BE(300, 6)
    fixed.writeUInt16BE(rr.rdata.length, 10)
    return Buffer.concat([fixed, rr.rdata])
  })
  return Buffer.concat([header, questionOf(query), ...rrs])
}

type Handler = (query: Buffer) => Buffer | null

const open: Array<Socket | Server> = []
afterEach(async () => {
  await Promise.all(
    open.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  )
})

/** The client endpoint and server socket of the latest query, for replies sent later. */
let lastPeer: { address: string; port: number } | null = null
let realSocket: Socket | null = null

/** A UDP nameserver on 127.0.0.1; null from the handler means stay silent. */
async function udpServer(handler: Handler): Promise<{ port: number; queries: Buffer[] }> {
  const queries: Buffer[] = []
  const socket = createSocket('udp4')
  open.push(socket)
  socket.on('message', (msg, rinfo) => {
    lastPeer = { address: rinfo.address, port: rinfo.port }
    realSocket = socket
    queries.push(msg)
    const reply = handler(msg)
    if (reply) socket.send(reply, rinfo.port, rinfo.address)
  })
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  return { port: socket.address().port, queries }
}

/** A TCP nameserver on 127.0.0.1 at `port`, speaking length-prefixed DNS. */
async function tcpServer(port: number, handler: Handler): Promise<void> {
  const server = createServer((conn) => {
    let buf = Buffer.alloc(0)
    conn.on('data', (chunk) => {
      buf = Buffer.concat([buf, Buffer.from(chunk)])
      if (buf.length < 2 || buf.length < 2 + buf.readUInt16BE(0)) return
      const reply = handler(buf.subarray(2, 2 + buf.readUInt16BE(0)))
      if (!reply) return
      const len = Buffer.alloc(2)
      len.writeUInt16BE(reply.length)
      conn.end(Buffer.concat([len, reply]))
    })
  })
  open.push(server)
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
}

/** Whether a query carries an EDNS OPT record (ARCOUNT is its only additional). */
const hasOpt = (q: Buffer) => q.readUInt16BE(10) > 0

const at = (port: number) => [{ address: '127.0.0.1', port }]
const fast = { timeoutMs: 300, tries: 1 }

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (err) {
    return (err as { code?: string }).code
  }
  return undefined
}

// ---------------------------------------------------------------------------

describe('queryTxt', () => {
  it('keeps the strings of each record together, as published', async () => {
    const a = 'p'.repeat(255)
    const { port } = await udpServer((q) => respond(q, [txt(a, 'tail'), txt('other=1')]))
    expect(await queryTxt('sel._domainkey.acme.test', { ...fast, servers: at(port) })).toEqual([
      [a, 'tail'],
      ['other=1'],
    ])
  })

  it('keeps a separate 255-byte record separate from the one after it', async () => {
    const a = 'x'.repeat(255)
    const { port } = await udpServer((q) => respond(q, [txt(a), txt('tok=1')]))
    expect(await queryTxt('acme.test', { ...fast, servers: at(port) })).toEqual([[a], ['tok=1']])
  })

  it('reads only TXT answers, past a CNAME the name points through', async () => {
    const cname = Buffer.from([
      3,
      'w'.charCodeAt(0),
      'w'.charCodeAt(0),
      'w'.charCodeAt(0),
      0xc0,
      0x0c,
    ])
    const { port } = await udpServer((q) =>
      respond(q, [{ type: 5, rdata: cname }, txt('v=spf1 -all')])
    )
    expect(await queryTxt('acme.test', { ...fast, servers: at(port) })).toEqual([['v=spf1 -all']])
  })

  it('asks for TXT by its canonical name, with recursion and room for a large answer', async () => {
    const { port, queries } = await udpServer((q) => respond(q, [txt('a')]))
    await queryTxt('Sel._DomainKey.acme.test.', { ...fast, servers: at(port) })
    const q = queries[0]
    expect(q.readUInt16BE(2) & 0x0100).toBe(0x0100) // RD
    expect(q.readUInt16BE(4)).toBe(1) // one question
    expect(q.readUInt16BE(10)).toBe(1) // one additional: the EDNS OPT record
    const question = questionOf(q)
    expect(question.subarray(0, -4).toString('latin1')).toBe(
      '\x03sel\x0a_domainkey\x04acme\x04test\x00'
    )
    expect(question.readUInt16BE(question.length - 4)).toBe(16) // TXT
    const opt = q.subarray(12 + question.length)
    expect(opt.readUInt16BE(1)).toBe(41) // OPT
    expect(opt.readUInt16BE(3)).toBeGreaterThanOrEqual(1232) // UDP payload size
  })

  it('reports a name that does not exist as nothing published', async () => {
    const { port } = await udpServer((q) => respond(q, [], { rcode: 3 }))
    const code = await codeOf(queryTxt('missing.acme.test', { ...fast, servers: at(port) }))
    expect(code).toBe('ENOTFOUND')
    expect(isNoAnswer({ code })).toBe(true)
  })

  it('reports a name with no TXT records as nothing published', async () => {
    const { port } = await udpServer((q) => respond(q, []))
    const code = await codeOf(queryTxt('acme.test', { ...fast, servers: at(port) }))
    expect(code).toBe('ENODATA')
    expect(isNoAnswer({ code })).toBe(true)
  })

  it('reports a failing nameserver as no answer, not as nothing published', async () => {
    const { port } = await udpServer((q) => respond(q, [], { rcode: 2 }))
    const code = await codeOf(queryTxt('acme.test', { ...fast, servers: at(port) }))
    expect(code).toBe('ESERVFAIL')
    expect(isNoAnswer({ code })).toBe(false)
  })

  it('moves on to the next nameserver when one fails', async () => {
    const bad = await udpServer((q) => respond(q, [], { rcode: 2 }))
    const good = await udpServer((q) => respond(q, [txt('ok')]))
    const servers = [...at(bad.port), ...at(good.port)]
    expect(await queryTxt('acme.test', { ...fast, servers })).toEqual([['ok']])
  })

  it('times out a silent nameserver after the tries asked for and one plain retry', async () => {
    const { port, queries } = await udpServer(() => null)
    const started = Date.now()
    const code = await codeOf(
      queryTxt('acme.test', { timeoutMs: 100, tries: 2, servers: at(port) })
    )
    expect(code).toBe('ETIMEOUT')
    expect(isNoAnswer({ code })).toBe(false)
    // EDNS, then once without it in case EDNS was dropped, then the second try.
    expect(queries.map(hasOpt)).toEqual([true, false, false])
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('asks again without EDNS when the nameserver rejects it', async () => {
    const { port, queries } = await udpServer((q) =>
      hasOpt(q) ? respond(q, [], { rcode: 1 }) : respond(q, [txt('plain=1')])
    )
    expect(await queryTxt('acme.test', { ...fast, servers: at(port) })).toEqual([['plain=1']])
    expect(queries.map(hasOpt)).toEqual([true, false])
  })

  it('asks again without EDNS when the EDNS query is dropped on the way', async () => {
    const { port } = await udpServer((q) => (hasOpt(q) ? null : respond(q, [txt('plain=1')])))
    expect(await queryTxt('acme.test', { timeoutMs: 100, tries: 1, servers: at(port) })).toEqual([
      ['plain=1'],
    ])
  })

  it('does not drop EDNS for an answer that says nothing is published', async () => {
    const { port, queries } = await udpServer((q) => respond(q, [], { rcode: 3 }))
    expect(await codeOf(queryTxt('acme.test', { ...fast, servers: at(port) }))).toBe('ENOTFOUND')
    expect(queries).toHaveLength(1)
  })

  it('ignores a reply that does not answer its query', async () => {
    const { port } = await udpServer((q) =>
      respond(q, [txt('spoofed')], { id: q.readUInt16BE(0) ^ 1 })
    )
    expect(await codeOf(queryTxt('acme.test', { ...fast, servers: at(port) }))).toBe('ETIMEOUT')
  })

  it('ignores a reply with the right id from anywhere but the nameserver it asked', async () => {
    // A forger who knows the id answers first from another port; the real
    // nameserver answers moments later. Only the real answer may be read.
    const stranger = createSocket('udp4')
    open.push(stranger)
    await new Promise<void>((resolve) => stranger.bind(0, '127.0.0.1', resolve))
    const { port } = await udpServer((q) => {
      const peer = lastPeer
      if (peer) stranger.send(respond(q, [txt('forged=1')]), peer.port, peer.address)
      setTimeout(() => {
        if (peer) realSocket?.send(respond(q, [txt('real=1')]), peer.port, peer.address)
      }, 30)
      return null
    })
    expect(await queryTxt('acme.test', { timeoutMs: 500, tries: 1, servers: at(port) })).toEqual([
      ['real=1'],
    ])
  })

  it('ignores a reply with the right id that answers a different question', async () => {
    const { port } = await udpServer((q) => {
      const other = Buffer.from(q)
      // Swap the first letter of the asked name: same id, same server, wrong question.
      other[13] = other[13] === 0x61 ? 0x62 : 0x61
      return respond(other, [txt('forged=1')], { id: q.readUInt16BE(0) })
    })
    expect(await codeOf(queryTxt('acme.test', { ...fast, servers: at(port) }))).toBe('ETIMEOUT')
  })

  it('matches the question without regard to letter case', async () => {
    const { port } = await udpServer((q) => {
      const upper = Buffer.from(q)
      upper[13] = upper[13] & ~0x20 // the first letter, upper-cased
      return respond(upper, [txt('ok')], { id: q.readUInt16BE(0) })
    })
    expect(await queryTxt('acme.test', { ...fast, servers: at(port) })).toEqual([['ok']])
  })

  it('asks again over TCP when the UDP answer was cut short', async () => {
    const big = 'k'.repeat(255)
    const { port } = await udpServer((q) => respond(q, [], { tc: true }))
    await tcpServer(port, (q) => respond(q, [txt(big, big, 'end')]))
    expect(await queryTxt('acme.test', { ...fast, servers: at(port) })).toEqual([[big, big, 'end']])
  })

  it('refuses a name it cannot put on the wire', async () => {
    const servers = at(1)
    expect(await codeOf(queryTxt(`${'a'.repeat(64)}.acme.test`, { ...fast, servers }))).toBe(
      'EBADNAME'
    )
    expect(await codeOf(queryTxt('a..acme.test', { ...fast, servers }))).toBe('EBADNAME')
    expect(await codeOf(queryTxt('bücher.test', { ...fast, servers }))).toBe('EBADNAME')
  })
})

describe('encodeTxtQuery', () => {
  it('puts the id it is given in the header', () => {
    expect(encodeTxtQuery(0xbeef, 'acme.test').readUInt16BE(0)).toBe(0xbeef)
  })
})

describe('parseServer', () => {
  it('reads every form the system lists nameservers in', () => {
    expect(parseServer('10.0.0.2')).toEqual({ address: '10.0.0.2', port: 53 })
    expect(parseServer('10.0.0.2:5353')).toEqual({ address: '10.0.0.2', port: 5353 })
    expect(parseServer('fd12::10')).toEqual({ address: 'fd12::10', port: 53 })
    expect(parseServer('[fd12::10]:5353')).toEqual({ address: 'fd12::10', port: 5353 })
  })
})
