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
    expect(typeof rec.env).toBe('string')
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
        req: { headers: { authorization: 'Bearer abc', host: 'localhost' } },
        post_id: 'keep_me',
      },
      'auth attempt',
    )

    const rec = sink.last()
    expect(rec.password).toBeUndefined()
    expect(rec.token).toBeUndefined()
    expect(rec.email).toBeUndefined()
    expect(rec.req.headers.authorization).toBeUndefined()
    // non-secret fields survive
    expect(rec.req.headers.host).toBe('localhost')
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
})
