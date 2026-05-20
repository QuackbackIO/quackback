import { describe, it, expect, vi } from 'vitest'
import {
  _internalEnsureNotSuspended,
  isSuspensionExempt,
  SUSPENSION_EXEMPT_PATHS,
} from '../suspension-guard'

describe('_internalEnsureNotSuspended', () => {
  it('does nothing when state is active', async () => {
    const readState = vi.fn(async () => 'active' as const)
    await expect(_internalEnsureNotSuspended(readState)).resolves.toBeUndefined()
  })

  it('throws SuspendedError 402 when state is suspended', async () => {
    const readState = vi.fn(async () => 'suspended' as const)
    await expect(_internalEnsureNotSuspended(readState)).rejects.toMatchObject({
      statusCode: 402,
      code: 'WORKSPACE_SUSPENDED',
    })
  })

  it('throws DeletingError 410 when state is deleting', async () => {
    const readState = vi.fn(async () => 'deleting' as const)
    await expect(_internalEnsureNotSuspended(readState)).rejects.toMatchObject({
      statusCode: 410,
      code: 'WORKSPACE_DELETING',
    })
  })
})

describe('isSuspensionExempt', () => {
  it('returns true for exact-match exempt paths', () => {
    for (const p of SUSPENSION_EXEMPT_PATHS) {
      expect(isSuspensionExempt(p)).toBe(true)
    }
  })

  it('returns true for descendant paths under exempt prefixes', () => {
    expect(isSuspensionExempt('/auth/login')).toBe(true)
    expect(isSuspensionExempt('/api/auth/sign-in')).toBe(true)
    expect(isSuspensionExempt('/.well-known/openid-configuration')).toBe(true)
  })

  it('returns false for other paths', () => {
    expect(isSuspensionExempt('/admin')).toBe(false)
    expect(isSuspensionExempt('/admin/dashboard')).toBe(false)
    expect(isSuspensionExempt('/api/v1/boards')).toBe(false)
  })

  it('exempts /verify-magic-link so suspended users can sign in via email link', () => {
    expect(isSuspensionExempt('/verify-magic-link')).toBe(true)
    expect(isSuspensionExempt('/verify-magic-link?token=abc')).toBe(true)
  })
})
