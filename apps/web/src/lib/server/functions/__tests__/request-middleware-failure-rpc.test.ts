// @vitest-environment node
/**
 * What the browser receives when request middleware fails a server-function
 * call, in production.
 *
 * Start serializes a request middleware's throw on a server-function request
 * straight into the reply, so it never passes the function middleware that
 * hides technical messages (server-fn-log.ts). The request boundary applies the
 * same rule instead. Driven end to end through `_server-fn-rpc`: the real Start
 * handler, the app's real request and function middleware, the real serializer
 * and the real client fetcher. Only the audit boundary, one of the request
 * middleware, is made to throw.
 */
import './_server-fn-rpc'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '@/lib/shared/errors'
import { UNEXPECTED_ERROR_MESSAGE, errorReferenceOf } from '@/lib/shared/error-reference'

const hoisted = vi.hoisted(() => ({ failure: null as Error | null }))
vi.mock('@/lib/server/audit/request-boundary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/audit/request-boundary')>()
  return {
    ...actual,
    handleRequestWithAuditAttribution: (
      opts: Parameters<typeof actual.handleRequestWithAuditAttribution>[0]
    ) => {
      if (hoisted.failure) throw hoisted.failure
      return actual.handleRequestWithAuditAttribution(opts)
    },
  }
})

const { createServerFnRpc } = await import('./_server-fn-rpc')

let call: () => Promise<unknown>
const failure = () =>
  call().then(
    () => undefined,
    (error: unknown) => error as Error
  )

beforeAll(async () => {
  const rpc = await createServerFnRpc()
  call = rpc.define({
    id: 'request-middleware-failure',
    method: 'POST',
    handler: async () => 'ok',
  })
})

describe('request middleware failing a server function, as the browser sees it', () => {
  afterEach(() => {
    hoisted.failure = null
    vi.unstubAllEnvs()
  })

  it('reaches the function when nothing fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(call()).resolves.toBe('ok')
  })

  it('hides a plain error behind a plain sentence in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    hoisted.failure = new Error('password authentication failed for user "tenant_7f3a"')
    const error = await failure()
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(UNEXPECTED_ERROR_MESSAGE)
    expect(error?.message).not.toContain('tenant_7f3a')
    expect(errorReferenceOf(error)).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('delivers a refusal written for a person as written', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    hoisted.failure = new ConflictError('WORKSPACE_MOVED', 'This workspace has moved')
    expect((await failure())?.message).toBe('This workspace has moved')
  })

  it('keeps the full message outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    hoisted.failure = new Error('password authentication failed for user "tenant_7f3a"')
    expect((await failure())?.message).toBe('password authentication failed for user "tenant_7f3a"')
  })
})
