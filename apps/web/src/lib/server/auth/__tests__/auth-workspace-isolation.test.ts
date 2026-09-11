/**
 * Workspace separation of the process-lifetime state in `auth/index.ts`.
 *
 * Two things live here that a pooled process cannot share: the credential
 * stashes the plugin callbacks write (keyed by a lowercased email address,
 * which is not unique across workspaces) and the rate-limit counters the
 * library keys by IP and path.
 *
 * Every stash assertion runs in BOTH orders. The stash is last-writer-wins, so
 * a one-directional test passes as soon as the surviving value happens to be
 * the one it read.
 */
import { describe, it, expect } from 'vitest'

const { storeOTP, getOTP, workspaceRateLimitStorage, __resetRateLimitCountersForWorkspace } =
  await import('../index')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const SHARED_ADDRESS = 'admin@example.com'

describe('OTP stash', () => {
  it('keeps two workspaces apart for the same address, alpha first', () => {
    withWorkspace('workspace-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'alpha-code'))
    withWorkspace('workspace-bravo', () => storeOTP('sign-in', SHARED_ADDRESS, 'bravo-code'))

    expect(withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe(
      'alpha-code'
    )
    expect(withWorkspace('workspace-bravo', () => getOTP('sign-in', SHARED_ADDRESS))).toBe(
      'bravo-code'
    )
  })

  it('keeps two workspaces apart for the same address, bravo first', () => {
    withWorkspace('workspace-bravo', () => storeOTP('sign-in', SHARED_ADDRESS, 'bravo-code-2'))
    withWorkspace('workspace-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'alpha-code-2'))

    expect(withWorkspace('workspace-bravo', () => getOTP('sign-in', SHARED_ADDRESS))).toBe(
      'bravo-code-2'
    )
    expect(withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe(
      'alpha-code-2'
    )
  })

  it('does not hand a workspace a code stashed with no workspace scope', () => {
    storeOTP('sign-in', SHARED_ADDRESS, 'unscoped-code')

    expect(
      withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))
    ).toBeUndefined()
    expect(getOTP('sign-in', SHARED_ADDRESS)).toBe('unscoped-code')
  })

  it('still drains once — a taken code is gone for its own workspace', () => {
    withWorkspace('workspace-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'once'))

    expect(withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('once')
    expect(
      withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))
    ).toBeUndefined()
  })

  it('keeps purpose separation inside one workspace', () => {
    withWorkspace('workspace-alpha', () => {
      storeOTP('sign-in', SHARED_ADDRESS, 'signin-code')
      storeOTP('change-email', SHARED_ADDRESS, 'change-code')
    })

    expect(withWorkspace('workspace-alpha', () => getOTP('change-email', SHARED_ADDRESS))).toBe(
      'change-code'
    )
    expect(withWorkspace('workspace-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe(
      'signin-code'
    )
  })
})

describe('rate-limit counters', () => {
  const key = '203.0.113.9/sign-in/email'
  const rule = { window: 60, max: 2 }

  it('counts each workspace separately for the same IP and path', async () => {
    await withWorkspace('workspace-alpha', async () => {
      __resetRateLimitCountersForWorkspace()
      expect(await workspaceRateLimitStorage.consume(key, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      })
      expect(await workspaceRateLimitStorage.consume(key, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      })
      expect((await workspaceRateLimitStorage.consume(key, rule)).allowed).toBe(false)
    })
    await withWorkspace('workspace-bravo', async () => {
      __resetRateLimitCountersForWorkspace()
      expect(await workspaceRateLimitStorage.consume(key, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      })
    })
  })

  it('does not let one workspace see another workspace-only counter', async () => {
    await withWorkspace('workspace-charlie', async () => {
      __resetRateLimitCountersForWorkspace()
      await workspaceRateLimitStorage.consume(key, { window: 60, max: 1 })
      expect((await workspaceRateLimitStorage.consume(key, { window: 60, max: 1 })).allowed).toBe(
        false
      )
    })

    expect(
      await withWorkspace('workspace-delta', async () => {
        const first = await workspaceRateLimitStorage.consume(key, { window: 60, max: 1 })
        return first.allowed
      })
    ).toBe(true)
  })
})
