/**
 * Tests for the AsyncLocalStorage-based per-request log context.
 *
 * This store carries request-scoped identity (request_id, route, tenant_id,
 * user_id) so the logger can stamp every line without threading a logger
 * through the call stack.
 */
import { describe, it, expect } from 'vitest'
import { getLogContext, runWithLogContext, setLogContext } from '../log-context'

describe('log-context', () => {
  it('returns undefined outside a request scope', () => {
    expect(getLogContext()).toBeUndefined()
  })

  it('exposes the context inside runWithLogContext', () => {
    runWithLogContext({ request_id: 'req_1' }, () => {
      expect(getLogContext()?.request_id).toBe('req_1')
    })
  })

  it('merges later enrichment via setLogContext', () => {
    runWithLogContext({ request_id: 'req_2', route: 'GET /x' }, () => {
      setLogContext({ tenant_id: 'ten_1', user_id: 'usr_1' })
      const ctx = getLogContext()
      expect(ctx).toMatchObject({
        request_id: 'req_2',
        route: 'GET /x',
        tenant_id: 'ten_1',
        user_id: 'usr_1',
      })
    })
  })

  it('does not leak context across sibling scopes', () => {
    runWithLogContext({ request_id: 'a' }, () => {
      setLogContext({ user_id: 'ua' })
    })
    runWithLogContext({ request_id: 'b' }, () => {
      expect(getLogContext()?.request_id).toBe('b')
      expect(getLogContext()?.user_id).toBeUndefined()
    })
    expect(getLogContext()).toBeUndefined()
  })

  it('propagates context across async awaits', async () => {
    await runWithLogContext({ request_id: 'async_1' }, async () => {
      await Promise.resolve()
      expect(getLogContext()?.request_id).toBe('async_1')
    })
  })

  it('setLogContext outside a scope is a no-op (does not throw)', () => {
    expect(() => setLogContext({ user_id: 'nobody' })).not.toThrow()
    expect(getLogContext()).toBeUndefined()
  })
})
