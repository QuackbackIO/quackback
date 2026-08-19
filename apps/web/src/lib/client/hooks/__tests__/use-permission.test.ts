// @vitest-environment happy-dom
/**
 * usePermission: the coarse client-side gate that decides whether to render a
 * permission-only UI affordance (e.g. the Copilot tab). The pure mapping
 * (resolvePermission) is the bulk of the logic and is tested standalone;
 * the hook itself is a thin wrapper pinning that it reads `principal.role`
 * from the `/admin` route context.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { PERMISSIONS } from '@/lib/shared/permissions'

describe('resolvePermission', () => {
  it('grants owner-preset permissions for the admin role (copilot.use included)', async () => {
    const { resolvePermission } = await import('../use-permission')
    expect(resolvePermission('admin', PERMISSIONS.COPILOT_USE)).toBe(true)
  })

  it('grants manager-preset permissions for the member role (copilot.use included, not workspace-admin-only)', async () => {
    const { resolvePermission } = await import('../use-permission')
    expect(resolvePermission('member', PERMISSIONS.COPILOT_USE)).toBe(true)
  })

  it('withholds a workspace-admin-only permission from the member role', async () => {
    const { resolvePermission } = await import('../use-permission')
    expect(resolvePermission('member', PERMISSIONS.BILLING_MANAGE)).toBe(false)
  })

  it('has no preset for an unrecognized legacy role', async () => {
    const { resolvePermission } = await import('../use-permission')
    expect(resolvePermission('user', PERMISSIONS.COPILOT_USE)).toBe(false)
  })

  it('is false for a null/undefined role', async () => {
    const { resolvePermission } = await import('../use-permission')
    expect(resolvePermission(null, PERMISSIONS.COPILOT_USE)).toBe(false)
    expect(resolvePermission(undefined, PERMISSIONS.COPILOT_USE)).toBe(false)
  })
})

describe('usePermission', () => {
  it('resolves from the /admin route context principal.role', async () => {
    vi.resetModules()
    vi.doMock('@tanstack/react-router', () => ({
      useRouteContext: () => ({ principal: { role: 'admin' } }),
    }))
    const { usePermission } = await import('../use-permission')

    const { result } = renderHook(() => usePermission(PERMISSIONS.COPILOT_USE))
    expect(result.current).toBe(true)

    vi.doUnmock('@tanstack/react-router')
    vi.resetModules()
  })

  it('is false when there is no principal on the route context', async () => {
    vi.resetModules()
    vi.doMock('@tanstack/react-router', () => ({
      useRouteContext: () => ({}),
    }))
    const { usePermission } = await import('../use-permission')

    const { result } = renderHook(() => usePermission(PERMISSIONS.COPILOT_USE))
    expect(result.current).toBe(false)

    vi.doUnmock('@tanstack/react-router')
    vi.resetModules()
  })
})
