// @vitest-environment happy-dom
/**
 * usePortalPermissions: render-only permission checks for the portal tree.
 * The set arrives from the _portal loader (server-resolved) through
 * PortalPermissionsProvider; outside any provider the hook must degrade to
 * the empty set so it is safe to call anywhere.
 */
import { describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { PortalPermissionsProvider, usePortalPermissions } from '../use-portal-permissions'

function withProvider(permissionKeys: string[]) {
  return ({ children }: { children: ReactNode }) =>
    createElement(PortalPermissionsProvider, { permissionKeys, children })
}

describe('usePortalPermissions', () => {
  it('is empty and denies everything outside a provider', () => {
    const { result } = renderHook(() => usePortalPermissions())

    expect(result.current.permissions.size).toBe(0)
    expect(result.current.can(PERMISSIONS.POST_SET_STATUS)).toBe(false)
    expect(result.current.hasAny(PERMISSIONS.POST_SET_STATUS, PERMISSIONS.COMMENT_PIN)).toBe(false)
  })

  it('grants exactly the provided keys', () => {
    const { result } = renderHook(() => usePortalPermissions(), {
      wrapper: withProvider([PERMISSIONS.POST_SET_STATUS, PERMISSIONS.COMMENT_PIN]),
    })

    expect(result.current.permissions.size).toBe(2)
    expect(result.current.can(PERMISSIONS.POST_SET_STATUS)).toBe(true)
    expect(result.current.can(PERMISSIONS.BILLING_MANAGE)).toBe(false)
  })

  it('hasAny is true when at least one key is held', () => {
    const { result } = renderHook(() => usePortalPermissions(), {
      wrapper: withProvider([PERMISSIONS.COMMENT_PIN]),
    })

    expect(result.current.hasAny(PERMISSIONS.BILLING_MANAGE, PERMISSIONS.COMMENT_PIN)).toBe(true)
    expect(result.current.hasAny(PERMISSIONS.BILLING_MANAGE)).toBe(false)
    expect(result.current.hasAny()).toBe(false)
  })

  it('denies everything for an empty key list (end user / visitor payload)', () => {
    const { result } = renderHook(() => usePortalPermissions(), {
      wrapper: withProvider([]),
    })

    expect(result.current.permissions.size).toBe(0)
    expect(result.current.can(PERMISSIONS.POST_SET_STATUS)).toBe(false)
  })
})
