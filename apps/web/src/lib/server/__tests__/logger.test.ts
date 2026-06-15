/**
 * Tests for the structured (Pino) logger.
 *
 * Asserts the wire format we depend on for LGTM/Loki ingestion: flat JSON,
 * string `level`, service/env bindings, request-context correlation via ALS,
 * and secret redaction.
 */
import { describe, it, expect } from 'vitest'
import { createLogger } from '../logger'
import { runWithLogContext } from '../log-context'
import * as clientStub from '../logger.client-stub'

/** Collect emitted lines into parsed JSON objects. */
function capture() {
  const lines: string[] = []
  const destination = { write: (s: string) => void lines.push(s) }
  return {
    destination,
    records: () => lines.map((l) => JSON.parse(l)),
    last: () => JSON.parse(lines[lines.length - 1]),
  }
}

describe('logger', () => {
  it('emits flat JSON with a string level, service_name, env and msg', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'info' })

    log.info('hello')

    const rec = sink.last()
    expect(rec.level).toBe('info') // string, not numeric — Loki level detection
    expect(rec.msg).toBe('hello')
    expect(rec.service_name).toBe('quackback-web')
    expect(rec.env).toBeUndefined() // env is not stamped on log lines
    expect(typeof rec.time).toBe('number') // epoch ms (Pino default)
  })

  it('stamps the active request context onto every line', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'info' })

    runWithLogContext({ request_id: 'req_42', route: 'POST /api/posts' }, () => {
      log.info({ post_id: 'post_1' }, 'post created')
    })

    const rec = sink.last()
    expect(rec.request_id).toBe('req_42')
    expect(rec.route).toBe('POST /api/posts')
    expect(rec.post_id).toBe('post_1')
  })

  it('does not add request fields when logging outside a request scope', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'info' })

    log.info('boot')

    expect(sink.last().request_id).toBeUndefined()
  })

  it('redacts secrets and PII', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'info' })

    log.info(
      {
        password: 'hunter2',
        token: 'tok_secret',
        email: 'user@example.com',
        'set-cookie': 'sid=top-secret',
        req: { headers: { authorization: 'Bearer abc', host: 'localhost' } },
        res: { headers: { 'set-cookie': 'sid=nested-secret', etag: 'W/keep' } },
        post_id: 'keep_me',
      },
      'auth attempt'
    )

    const rec = sink.last()
    expect(rec.password).toBeUndefined()
    expect(rec.token).toBeUndefined()
    expect(rec.email).toBeUndefined()
    expect(rec.req.headers.authorization).toBeUndefined()
    // hyphenated set-cookie must be redacted at top level AND nested in headers
    // (requires Pino bracket-notation redact paths)
    expect(rec['set-cookie']).toBeUndefined()
    expect(rec.res.headers['set-cookie']).toBeUndefined()
    // non-secret fields survive
    expect(rec.req.headers.host).toBe('localhost')
    expect(rec.res.headers.etag).toBe('W/keep')
    expect(rec.post_id).toBe('keep_me')
  })

  it('respects the configured level threshold', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'warn' })

    log.info('should be dropped')
    log.warn('should appear')

    const recs = sink.records()
    expect(recs).toHaveLength(1)
    expect(recs[0].msg).toBe('should appear')
  })

  it('serializes err with message, stack, and type', () => {
    const sink = capture()
    const log = createLogger({ destination: sink.destination, level: 'error' })

    log.error({ err: new Error('boom') }, 'failed')

    const rec = sink.last()
    expect(rec.msg).toBe('failed')
    expect(rec.err).toBeDefined()
    expect(rec.err.message).toBe('boom')
    expect(typeof rec.err.stack).toBe('string')
    expect(rec.err.type).toBe('Error')
  })
})

describe('logger client stub', () => {
  it('exposes no-op methods and child() chains without pino', () => {
    const { logger: stub } = clientStub

    // All log methods are callable and silent (no throw)
    expect(() => stub.trace('t')).not.toThrow()
    expect(() => stub.debug('d')).not.toThrow()
    expect(() => stub.info('i')).not.toThrow()
    expect(() => stub.warn('w')).not.toThrow()
    expect(() => stub.error('e')).not.toThrow()
    expect(() => stub.fatal('f')).not.toThrow()

    // child() returns another stub whose methods are also no-ops
    const child = stub.child({ component: 'test' })
    expect(() => child.info('nested')).not.toThrow()

    // child of child also works (unbounded chaining)
    const grandchild = child.child({ sub: 'x' })
    expect(() => grandchild.warn('deep')).not.toThrow()
  })
})
