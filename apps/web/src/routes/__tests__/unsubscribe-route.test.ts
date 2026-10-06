/**
 * The /unsubscribe page and its server functions must never throw on a token
 * that is merely malformed. Mail scanners rewrite and truncate links, and a
 * string that passes a loose hex pattern but is not a real UUID used to slip
 * past the page and then fail the server function's stricter schema, which
 * surfaced as a 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  processUnsubscribeToken: vi.fn(),
  previewUnsubscribeToken: vi.fn(),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  processUnsubscribeToken: hoisted.processUnsubscribeToken,
  previewUnsubscribeToken: hoisted.previewUnsubscribeToken,
}))

// Outside the Start compiler a server function never reaches its handler, so
// this runs the handler in-process. The validator is applied for real: a
// schema that throws on a malformed token is exactly what this suite guards.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    let validate = (data: unknown) => data
    const chain: Record<string, unknown> = {}
    chain.validator = (schema: { parse: (data: unknown) => unknown }) => {
      validate = (data) => schema.parse(data)
      return chain
    }
    chain.handler =
      (handler: (args: { data: unknown }) => Promise<unknown>) => (args?: { data?: unknown }) =>
        Promise.resolve().then(() => handler({ data: validate(args?.data) }))
    return chain
  },
}))

vi.mock('@/lib/server/functions/locale', () => ({
  loadPortalIntl: async () => ({ locale: 'en', messages: {} }),
}))

import { Route } from '../unsubscribe'
import { processUnsubscribeTokenFn } from '@/lib/server/functions/subscriptions'

/** Passes /^[0-9a-f-]{36}$/ but is not a UUID: the version nibble is 0. */
const NOT_A_UUID = '12345678-1234-0234-8234-123456789abc'
const VALID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

const loader = (
  Route.options as unknown as {
    loader: (ctx: { deps: { token?: string } }) => Promise<unknown>
  }
).loader

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.previewUnsubscribeToken.mockResolvedValue({ action: 'unsubscribe_all' })
  hoisted.processUnsubscribeToken.mockResolvedValue({
    action: 'unsubscribe_all',
    principalId: 'principal_x',
    postId: null,
  })
})

describe('/unsubscribe loader', () => {
  it('shows the invalid view for a token that only looks like a UUID', async () => {
    await expect(loader({ deps: { token: NOT_A_UUID } })).resolves.toMatchObject({
      status: 'error',
      error: 'invalid',
    })
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
    expect(hoisted.previewUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('shows the invalid view for garbage and the missing view for no token', async () => {
    await expect(loader({ deps: { token: 'abc' } })).resolves.toMatchObject({ error: 'invalid' })
    await expect(loader({ deps: {} })).resolves.toMatchObject({ error: 'missing' })
  })

  it('looks a valid token up without consuming it', async () => {
    await expect(loader({ deps: { token: VALID } })).resolves.toMatchObject({
      status: 'confirm',
      action: 'unsubscribe_all',
    })
    expect(hoisted.previewUnsubscribeToken).toHaveBeenCalledWith(VALID)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })
})

describe('processUnsubscribeTokenFn', () => {
  it('returns the typed invalid result for a malformed token instead of throwing', async () => {
    await expect(processUnsubscribeTokenFn({ data: { token: NOT_A_UUID } })).resolves.toEqual({
      success: false,
      error: 'invalid',
    })
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('processes a well-formed token', async () => {
    await expect(processUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toMatchObject({
      success: true,
      action: 'unsubscribe_all',
    })
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledWith(VALID)
  })
})
