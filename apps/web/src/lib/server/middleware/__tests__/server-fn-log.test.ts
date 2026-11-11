import { describe, it, expect, vi } from 'vitest'
import { redirect, notFound } from '@tanstack/react-router'
import { execValidator } from '@tanstack/react-start'
import { z } from 'zod'
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

  it('logs a rejection from the framework validator path at warn', async () => {
    // createServerFn().validator(zodSchema) runs through execValidator, which
    // does not rethrow the ZodError: it throws a plain Error whose message is
    // the JSON-serialised issue list. Capture the real thrown value.
    const schema = z.object({ token: z.string().uuid(), title: z.string().min(3) })
    const thrown = await execValidator(schema, { token: 'nope', title: 'x' }).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('Error')
    expect(classifyServerFnError(thrown)).toBe('warn')
  })

  it('does not mistake an ordinary error with a JSON message for a validation failure', () => {
    expect(classifyServerFnError(new Error('[]'))).toBe('error')
    expect(classifyServerFnError(new Error('[1, 2, 3]'))).toBe('error')
    expect(classifyServerFnError(new Error('{"message":"upstream said no"}'))).toBe('error')
    expect(classifyServerFnError(new Error('[not json'))).toBe('error')
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

describe('runWithServerFnLogging in production', () => {
  const failWith = (thrown: unknown, production: boolean, log = fakeLog()) => ({
    log,
    thrown: runWithServerFnLogging({
      next: async () => {
        throw thrown
      },
      name: 'fetchThings',
      log: log as never,
      production,
    }).then(
      () => undefined,
      (error: unknown) => error as Error
    ),
  })

  it('swaps a technical failure for a plain sentence and logs its reference', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'settings')")
    const { log, thrown } = failWith(bug, true)
    const error = await thrown

    expect(error).not.toBe(bug)
    expect(error?.message).toMatch(
      /^Something went wrong on our side\. Try again in a moment\. \(Ref [A-Z0-9]{4}-[A-Z0-9]{4}\)$/
    )
    const [fields] = log.error.mock.calls[0]
    // The log keeps the real error, findable by the code the person was shown.
    expect(fields.err).toBe(bug)
    expect(error?.message).toContain(`(Ref ${fields.error_ref})`)
  })

  it('rethrows the same failure unchanged outside production', async () => {
    const bug = new TypeError('boom')
    const { log, thrown } = failWith(bug, false)
    expect(await thrown).toBe(bug)
    expect(log.error.mock.calls[0][0]).not.toHaveProperty('error_ref')
  })

  it('leaves messages written for a person alone', async () => {
    const refusal = new ForbiddenError('NOPE', 'Only admins can do that')
    expect(await failWith(refusal, true).thrown).toBe(refusal)
    const plain = new Error('Pick a board first')
    expect(await failWith(plain, true).thrown).toBe(plain)
  })

  it('never touches framework control flow', async () => {
    const r = redirect({ to: '/' })
    expect(await failWith(r, true).thrown).toBe(r)
  })
})
