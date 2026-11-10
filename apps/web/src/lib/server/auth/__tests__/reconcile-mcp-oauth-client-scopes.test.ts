import { describe, expect, it, vi } from 'vitest'
import { reconcileMcpOauthClientScopes } from '../reconcile-mcp-oauth-client-scopes'

// Array semantics (widening, NULL kept, no-op on a covering row) are pinned on
// real Postgres in mcp-oauth-scope-catalogue.db.test.ts. This covers the
// failure path a database cannot easily be made to take.

describe('reconcileMcpOauthClientScopes', () => {
  it('logs and resolves when the update fails', async () => {
    const failure = new Error('connection reset')
    const execute = vi.fn(async () => {
      throw failure
    })
    const log = { warn: vi.fn() }

    await expect(reconcileMcpOauthClientScopes({ db: { execute }, log })).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String)
    )
  })
})
