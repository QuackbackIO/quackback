/**
 * The HTTP runtime prints any non-HTTP error that escapes a request with a
 * bare console.error, which Bun renders as a multi-line dump. These tests drive
 * the framework's real request handler, so they fail if the print moves or
 * changes shape, not only if our filter does.
 */
import { describe, it, expect } from 'vitest'
import { requestHandler } from '@tanstack/react-start/server'
import { createLogger } from '@/lib/server/logger'
import {
  installRuntimeErrorLog,
  isAbortError,
  noteLoggedAtBoundary,
} from '@/lib/server/runtime-error-log'

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
  fail: () => never
): Promise<Response> {
  const original = console.error
  console.error = (...args: unknown[]) => target.error(...args)
  try {
    const handle = requestHandler(async () => fail())
    return await handle(new Request('http://localhost/admin/feedback'), {} as never)
  } finally {
    console.error = original
  }
}

describe('installRuntimeErrorLog', () => {
  it('drops the dump for a client that closed the connection', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    const res = await runThroughFramework(target, () => {
      throw new DOMException('The connection was closed.', 'AbortError')
    })

    expect(res.status).toBe(500)
    expect(printed).toEqual([])
    expect(cap.records().some((r) => r.level === 'error')).toBe(false)
  })

  it('logs any other escaped error as one structured line', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(target, () => {
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

  it('stays quiet for an error the request boundary already logged', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    const boom = new Error('kaboom')
    noteLoggedAtBoundary(boom)
    await runThroughFramework(target, () => {
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

describe('isAbortError', () => {
  it('recognises an aborted request and nothing else', () => {
    expect(isAbortError(new DOMException('The connection was closed.', 'AbortError'))).toBe(true)
    expect(isAbortError(new DOMException('timed out', 'TimeoutError'))).toBe(false)
    expect(isAbortError(new Error('AbortError'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
