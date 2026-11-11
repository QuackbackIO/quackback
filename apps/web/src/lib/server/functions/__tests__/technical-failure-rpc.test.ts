/**
 * What the browser receives when a server function fails, in production.
 *
 * Driven end to end through `_server-fn-rpc`: the real Start handler, the
 * app's real function middleware on both sides and the real serializer. A
 * technical failure must arrive as a plain sentence with its reference lifted
 * off; a message written for a person must arrive as written.
 */
import './_server-fn-rpc'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { ConflictError } from '@/lib/shared/errors'
import { UNEXPECTED_ERROR_MESSAGE, errorReferenceOf } from '@/lib/shared/error-reference'

const { createServerFnRpc } = await import('./_server-fn-rpc')

const fns: Record<string, () => Promise<unknown>> = {}
const failure = (name: string) =>
  fns[name]().then(
    () => undefined,
    (error: unknown) => error as Error
  )

beforeAll(async () => {
  const rpc = await createServerFnRpc()
  const define = (id: string, fail: () => never) =>
    (fns[id] = rpc.define({
      id: `technical-failure-${id}`,
      method: 'POST',
      handler: async () => fail(),
    }))

  define('database', () => {
    throw new DrizzleQueryError(
      'select "email" from "principals" where "email" = $1',
      ['dana@acme.com'],
      new Error('relation "principals" does not exist')
    )
  })
  define('network', () => {
    throw Object.assign(new Error('connect ECONNREFUSED 10.0.4.17:5432'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
    })
  })
  define('bug', () => {
    const missing = undefined as unknown as { settings: { name: string } }
    throw new Error(missing.settings.name)
  })
  define('refusal', () => {
    throw new ConflictError('DUPLICATE_SLUG', 'A board with this slug already exists')
  })
  define('plain', () => {
    throw new Error('Pick a board first')
  })
})

describe('a failing server function, as the browser sees it in production', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['database', 'network', 'bug'])(
    'hides a %s failure behind a plain sentence',
    async (name) => {
      vi.stubEnv('NODE_ENV', 'production')
      const error = await failure(name)
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe(UNEXPECTED_ERROR_MESSAGE)
      expect(errorReferenceOf(error)).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    }
  )

  it('delivers a message written for a person as written', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect((await failure('refusal'))?.message).toBe('A board with this slug already exists')
    expect((await failure('plain'))?.message).toBe('Pick a board first')
  })

  it('keeps the full message outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await failure('database'))?.message).toContain('dana@acme.com')
    expect((await failure('network'))?.message).toBe('connect ECONNREFUSED 10.0.4.17:5432')
  })
})
