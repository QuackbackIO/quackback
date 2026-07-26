import { describe, it, expect, vi } from 'vitest'
import { redirect, notFound } from '@tanstack/react-router'
import { classifyServerFnError, runWithServerFnLogging } from '../server-fn-log'
import {
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/shared/errors'

function fakeLog() {
  return { warn: vi.fn(), error: vi.fn() }
}

describe('classifyServerFnError', () => {
  it('does not log framework control flow', () => {
    // A signed-out visitor being redirected is the system working, and this is
    // the busiest path in the app.
    expect(classifyServerFnError(redirect({ to: '/' }))).toBeNull()
    expect(classifyServerFnError(notFound())).toBeNull()
  })

  it('logs client-caused domain errors at warn', () => {
    expect(classifyServerFnError(new ValidationError('BAD', 'bad'))).toBe('warn')
    expect(classifyServerFnError(new ForbiddenError('NOPE', 'nope'))).toBe('warn')
    expect(classifyServerFnError(new NotFoundError('GONE', 'gone'))).toBe('warn')
    expect(classifyServerFnError(new RateLimitError(30))).toBe('warn')
  })

  it('logs server-caused domain errors at error', () => {
    expect(classifyServerFnError(new InternalError('DB', 'db down'))).toBe('error')
  })

  it('logs validator rejections at warn, not error', () => {
    // Validators run upstream of the handler, so a stale client or a bot
    // hitting the endpoint with a malformed payload surfaces here.
    const zodish = Object.assign(new Error('Invalid input'), {
      name: 'ZodError',
      issues: [{ path: ['email'], message: 'Required' }],
    })
    expect(classifyServerFnError(zodish)).toBe('warn')

    const standardSchemaish = Object.assign(new Error('Invalid input'), {
      issues: [{ message: 'Required' }],
    })
    expect(classifyServerFnError(standardSchemaish)).toBe('warn')
  })

  it('logs auth denials at warn', () => {
    // requireAuth throws a plain Error, and a signed-out call is the single
    // most common expected failure — at error it would swamp everything else.
    expect(classifyServerFnError(new Error('Authentication required'))).toBe('warn')
    expect(classifyServerFnError(new Error('Access denied: post.view_private'))).toBe('warn')
  })

  it('reads a statusCode off errors that are not DomainExceptions', () => {
    // e.g. CopilotUnavailableError, which carries a status without the base class.
    expect(classifyServerFnError(Object.assign(new Error('gate'), { statusCode: 404 }))).toBe(
      'warn'
    )
    expect(classifyServerFnError(Object.assign(new Error('gate'), { statusCode: 503 }))).toBe(
      'error'
    )
  })

  it('logs anything unrecognised at error', () => {
    expect(classifyServerFnError(new Error('boom'))).toBe('error')
    expect(classifyServerFnError('boom')).toBe('error')
    expect(classifyServerFnError(null)).toBe('error')
  })
})

describe('runWithServerFnLogging', () => {
  it('passes the result through untouched on success', async () => {
    const log = fakeLog()
    const result = await runWithServerFnLogging({
      next: async () => ({ ok: true }),
      name: 'fetchThings',
      log: log as never,
    })
    expect(result).toEqual({ ok: true })
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs the failure and rethrows it unchanged', async () => {
    const log = fakeLog()
    const boom = new Error('boom')
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw boom
        },
        name: 'fetchThings',
        log: log as never,
      })
    ).rejects.toBe(boom)

    expect(log.error).toHaveBeenCalledTimes(1)
    const [fields, message] = log.error.mock.calls[0]
    expect(message).toBe('fetchThings failed')
    expect(fields.err).toBe(boom)
    expect(fields.server_fn).toBe('fetchThings')
    expect(typeof fields.duration_ms).toBe('number')
  })

  it('rethrows a redirect without logging it', async () => {
    const log = fakeLog()
    const r = redirect({ to: '/' })
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw r
        },
        name: 'requireWorkspace',
        log: log as never,
      })
    ).rejects.toBe(r)

    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('uses warn for a 4xx domain error', async () => {
    const log = fakeLog()
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw new ForbiddenError('NOPE', 'nope')
        },
        name: 'deleteThing',
        log: log as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalled()
  })
})
