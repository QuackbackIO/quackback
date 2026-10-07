/**
 * The HTTP runtime prints any non-HTTP error that escapes a request with a
 * bare console.error, which Bun renders as a multi-line dump. These tests drive
 * the framework's real request handler, and where it matters the real request
 * boundary inside it, so they fail if the print moves or changes shape, or if
 * the boundary stops telling the runtime log what it already logged.
 */
import { describe, it, expect, vi } from 'vitest'
import { requestHandler } from '@tanstack/react-start/server'
import { createLogger } from '@/lib/server/logger'
import { handleRequestWithContext } from '@/lib/server/middleware/request-context'
import { installRuntimeErrorLog, isClientDisconnect } from '@/lib/server/runtime-error-log'

function capture() {
  const lines: string[] = []
  const log = createLogger({
    level: 'debug',
    destination: { write: (s: string) => void lines.push(s) },
  })
  return { log, records: () => lines.map((l) => JSON.parse(l)) }
}

/** A console stand-in, so the test never patches the real one. */
function fakeConsole() {
  const printed: unknown[][] = []
  return { printed, target: { error: (...args: unknown[]) => void printed.push(args) } }
}

/** Run one request through the framework with the given console.error. */
async function runThroughFramework(
  target: { error: (...args: unknown[]) => void },
  handler: (request: Request) => Promise<Response>,
  request = new Request('http://localhost/admin/feedback')
): Promise<Response> {
  const original = console.error
  console.error = (...args: unknown[]) => target.error(...args)
  try {
    return await requestHandler(handler)(request, {} as never)
  } finally {
    console.error = original
  }
}

const closed = () => new DOMException('The connection was closed.', 'AbortError')

describe('installRuntimeErrorLog', () => {
  it('drops the dump for a client disconnect the request boundary saw', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()
    const reason = closed()

    const res = await runThroughFramework(
      target,
      (request) =>
        handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => {
            controller.abort(reason)
            throw reason
          },
        }) as never,
      new Request('http://localhost/admin/feedback', { signal: controller.signal })
    )

    expect(res.status).toBe(500)
    expect(printed).toEqual([])
    const records = cap.records()
    expect(records.some((r) => r.level === 'error')).toBe(false)
    expect(records.map((r) => r.msg)).toEqual(['request aborted by client'])
  })

  it('drops a disconnect the framework raises after the boundary has returned', async () => {
    // The framework rethrows the signal's reason once the middleware chain is
    // done, so this throw never passes through the boundary's catch.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()

    await runThroughFramework(
      target,
      async (request) => {
        await handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => ({ response: new Response('ok') }),
        })
        controller.abort(closed())
        throw request.signal.reason
      },
      new Request('http://localhost/admin/feedback', { signal: controller.signal })
    )

    expect(printed).toEqual([])
    expect(cap.records().some((r) => r.level === 'error')).toBe(false)
  })

  it('logs an AbortError that is not a client disconnect', async () => {
    // e.g. our own cancelled outbound fetch escaping a route.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(target, async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    })

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records).toHaveLength(1)
    expect(records[0].level).toBe('error')
    expect(records[0].msg).toBe('unhandled request error')
  })

  it('logs any other escaped error as one structured line', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(target, async () => {
      throw new TypeError('cannot read properties of undefined')
    })

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records).toHaveLength(1)
    expect(records[0].level).toBe('error')
    expect(records[0].msg).toBe('unhandled request error')
    expect(records[0].status).toBe(500)
    // The original error, not the runtime's wrapper around it.
    expect(records[0].err.type).toBe('TypeError')
    expect(records[0].err.message).toBe('cannot read properties of undefined')
  })

  it('does not log again an error the request boundary already logged', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(
      target,
      (request) =>
        handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => {
            throw new Error('kaboom')
          },
        }) as never
    )

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records.map((r) => [r.level, r.msg])).toEqual([['error', 'request failed']])
  })

  it('shares what the boundary logged with a wrapper installed before a module reload', async () => {
    // A dev reload re-evaluates this module but the console keeps the first
    // wrapper (the install guard lives on the console), so both must read one set.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    vi.resetModules()
    const reloaded = await import('@/lib/server/runtime-error-log')
    const boom = new Error('kaboom')
    reloaded.noteLoggedAtBoundary(boom)

    await runThroughFramework(target, async () => {
      throw boom
    })

    expect(printed).toEqual([])
    expect(cap.records()).toEqual([])
  })

  it('passes every other console.error call through untouched', () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    const plain = new Error('library failure')
    target.error('Error in SSR cleanup:', plain)
    target.error(plain)

    expect(printed).toEqual([['Error in SSR cleanup:', plain], [plain]])
    expect(cap.records()).toEqual([])
  })

  it('wraps the target only once', () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    installRuntimeErrorLog({ log: cap.log, target })

    target.error('once')
    expect(printed).toEqual([['once']])
  })
})

describe('isClientDisconnect', () => {
  it("is the request's own abort and nothing else", () => {
    const controller = new AbortController()
    const request = new Request('http://localhost/', { signal: controller.signal })
    const reason = closed()

    // Not yet aborted: an AbortError by name alone is not a disconnect.
    expect(isClientDisconnect(reason, request)).toBe(false)

    controller.abort(reason)
    expect(isClientDisconnect(request.signal.reason, request)).toBe(true)
    expect(isClientDisconnect(closed(), request)).toBe(true)
    expect(isClientDisconnect(new TypeError('boom'), request)).toBe(false)
    expect(isClientDisconnect(new DOMException('timed out', 'TimeoutError'), request)).toBe(false)
  })
})
