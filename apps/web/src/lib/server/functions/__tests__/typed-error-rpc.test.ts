// @vitest-environment node
/**
 * What the browser receives when a server function throws a typed error, in
 * production: driven end to end through `_server-fn-rpc` (the real Start
 * handler, the app's function middleware and the real serializer).
 *
 * A typed error below 500 keeps its `code` and `statusCode` beside its
 * message, so the client can act on the code (stop retrying a NotFound read,
 * tell a test-data link conflict apart). A typed error of 500 or above and a
 * plain throw arrive exactly as before: their message only, a technical one
 * hidden behind a plain sentence. Nothing else on the error (its cause, its
 * stack) crosses.
 *
 * Runs in Node: a browser-like test environment drops the Origin and
 * Sec-Fetch-Site headers the harness sets, and the CSRF check then refuses
 * every call.
 */
import './_server-fn-rpc'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  isNotFoundError,
} from '@/lib/shared/errors'
import { UNEXPECTED_ERROR_MESSAGE } from '@/lib/shared/error-reference'
import { isTestDataLinkConflict } from '@/lib/shared/tickets'

const { createServerFnRpc } = await import('./_server-fn-rpc')

const fns: Record<string, () => Promise<unknown>> = {}
const failure = (name: string) =>
  fns[name]().then(
    () => undefined,
    (error: unknown) => error as Error & Record<string, unknown>
  )

beforeAll(async () => {
  const rpc = await createServerFnRpc()
  const define = (id: string, fail: () => never) =>
    (fns[id] = rpc.define({ id: `typed-error-${id}`, method: 'POST', handler: async () => fail() }))
  define('not-found', () => {
    throw new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found', new Error('select … secret'))
  })
  define('link-conflict', () => {
    throw new ConflictError(
      'TEST_DATA_LINK_CONFLICT',
      'Test and real conversations need separate tickets.'
    )
  })
  define('internal', () => {
    throw new InternalError('NO_DEFAULT_STATUS', 'No default ticket status is configured')
  })
  define('outage', () => {
    throw new ServiceUnavailableError(
      'MAIL_PROVIDER_UNREACHABLE',
      "Couldn't reach the mail provider. Try again in a minute."
    )
  })
  define('plain', () => {
    throw new Error('Pick a board first')
  })
})

describe('a typed server-function error, as the browser sees it in production', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('a NotFound arrives with its code and status, and reads as NotFound', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const error = await failure('not-found')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Ticket not found',
      code: 'TICKET_NOT_FOUND',
      statusCode: 404,
    })
    expect(isNotFoundError(error)).toBe(true)
    expect(error?.cause).toBeUndefined()
  })

  it('a test-data link conflict arrives with the code the create dialog acts on', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const error = await failure('link-conflict')
    expect(error).toMatchObject({ code: 'TEST_DATA_LINK_CONFLICT', statusCode: 409 })
    expect(isTestDataLinkConflict(error)).toBe(true)
  })

  it('a typed error of 500 or above keeps no code or status', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const internal = await failure('internal')
    expect(internal?.message).toBe(UNEXPECTED_ERROR_MESSAGE)
    expect(internal?.code).toBeUndefined()
    expect(internal?.statusCode).toBeUndefined()
    const outage = await failure('outage')
    expect(outage?.message).toBe("Couldn't reach the mail provider. Try again in a minute.")
    expect(outage?.code).toBeUndefined()
    expect(outage?.statusCode).toBeUndefined()
  })

  it('a plain throw stays hidden and reads as nothing typed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const error = await failure('plain')
    expect(error?.message).toBe(UNEXPECTED_ERROR_MESSAGE)
    expect(error?.code).toBeUndefined()
    expect(isNotFoundError(error)).toBe(false)
  })
})
