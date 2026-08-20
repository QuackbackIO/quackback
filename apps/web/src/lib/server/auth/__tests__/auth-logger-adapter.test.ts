import { describe, it, expect, vi } from 'vitest'
import { redactLogArgs, createAuthLogger } from '../auth-logger-adapter'

describe('redactLogArgs', () => {
  it('passes strings and primitives through unchanged', () => {
    expect(redactLogArgs(['plain message', 42, true, null])).toEqual([
      'plain message',
      42,
      true,
      null,
    ])
  })

  it('reduces an object to its key names, never its values', () => {
    // The payload the library logs alongside a resolution failure is the whole
    // user-info object. Keys tell you which claims arrived, which is the
    // diagnostic value; the values are the PII.
    const [redacted] = redactLogArgs([
      { sub: 'abc', email: 'someone@example.com', name: 'Some One' },
    ])
    expect(redacted).toEqual({ keys: ['sub', 'email', 'name'] })
    expect(JSON.stringify(redacted)).not.toContain('someone@example.com')
    expect(JSON.stringify(redacted)).not.toContain('Some One')
  })

  it('does not leak values nested inside an object', () => {
    const [redacted] = redactLogArgs([{ profile: { email: 'deep@example.com' } }])
    expect(JSON.stringify(redacted)).not.toContain('deep@example.com')
  })

  it('keeps an Error name and message but drops attached properties', () => {
    const err = Object.assign(new Error('token exchange failed'), {
      email: 'leaky@example.com',
    })
    const [redacted] = redactLogArgs([err])
    expect(redacted).toEqual({ error: 'Error', message: 'token exchange failed' })
    expect(JSON.stringify(redacted)).not.toContain('leaky@example.com')
  })

  it('reduces arrays to a length rather than their contents', () => {
    const [redacted] = redactLogArgs([['a@example.com', 'b@example.com']])
    expect(redacted).toEqual({ items: 2 })
  })
})

describe('createAuthLogger', () => {
  it('routes each level at the matching severity and redacts the payload', () => {
    const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const logger = createAuthLogger(sink)

    logger.log?.('error', 'Unable to get user info', { email: 'x@example.com' })
    expect(sink.error).toHaveBeenCalledTimes(1)
    const [payload, message] = sink.error.mock.calls[0]
    expect(message).toBe('Unable to get user info')
    expect(JSON.stringify(payload)).not.toContain('x@example.com')

    logger.log?.('warn', 'heads up')
    expect(sink.warn).toHaveBeenCalledTimes(1)
    logger.log?.('info', 'fyi')
    expect(sink.info).toHaveBeenCalledTimes(1)
    logger.log?.('debug', 'noisy')
    expect(sink.debug).toHaveBeenCalledTimes(1)
  })

  /**
   * The case the suite above cannot see.
   *
   * Its sink is a plain object of `vi.fn()`s, and a `vi.fn()` does not care
   * what `this` is — so it passes whether the adapter calls the method on the
   * sink or detaches it first. The real sink is a **pino** child, whose
   * `error`/`warn`/`info` read instance state off `this`. Detached, they throw,
   * and because better-auth calls this from inside request handling the throw
   * surfaced as an HTTP 500 on a successful sign-in.
   *
   * So this sink is one whose methods genuinely require their receiver.
   */
  it('calls the sink as a method, so a receiver-dependent logger works', () => {
    const seen: Array<{ level: string; message: string }> = []
    const sink = {
      prefix: 'auth',
      error(_payload: unknown, message: string) {
        seen.push({ level: 'error', message: `${this.prefix}:${message}` })
      },
      warn(_payload: unknown, message: string) {
        seen.push({ level: 'warn', message: `${this.prefix}:${message}` })
      },
      info(_payload: unknown, message: string) {
        seen.push({ level: 'info', message: `${this.prefix}:${message}` })
      },
      debug(_payload: unknown, message: string) {
        seen.push({ level: 'debug', message: `${this.prefix}:${message}` })
      },
    }

    const logger = createAuthLogger(sink)
    expect(() => logger.log?.('error', 'boom')).not.toThrow()
    expect(seen).toEqual([{ level: 'error', message: 'auth:boom' }])
  })
})
