// @vitest-environment happy-dom
import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const navigate = vi.fn()
const invalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate, invalidate }),
}))

// Capture only GateCard's broadcast onSuccess (no `enabled` prop).
// AuthDialog also calls useAuthBroadcast but always passes `enabled`.
let broadcastOnSuccess: (() => void) | undefined
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: (opts: { onSuccess?: () => void; enabled?: boolean }) => {
    if (!('enabled' in opts)) broadcastOnSuccess = opts.onSuccess
  },
  postAuthSuccess: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: () => null,
}))

const openAuthPopover = vi.fn()
vi.mock('@/components/auth/auth-popover-context', async (orig) => ({
  ...(await orig<typeof import('@/components/auth/auth-popover-context')>()),
  // Pass-through wrapper so GateCard renders without a real context provider.
  AuthPopoverProvider: ({ children }: { children: unknown }) => children,
  useAuthPopover: () => ({ openAuthPopover }),
}))

vi.mock('@/lib/client/post-auth-navigation', () => ({ navigateAfterAuth: vi.fn() }))

import { PortalAccessGate } from '../portal-access-gate'
import { navigateAfterAuth } from '@/lib/client/post-auth-navigation'

const baseProps = {
  reason: 'unauthenticated' as const,
  workspaceName: 'Acme',
  logoUrl: null,
  authConfig: { found: true, oauth: { password: true }, oidcProviders: undefined },
  themeStyles: '',
  customCss: '',
  userEmail: null,
  locale: 'en' as const,
}

beforeEach(() => {
  navigate.mockClear()
  invalidate.mockClear()
  openAuthPopover.mockClear()
  vi.mocked(navigateAfterAuth).mockClear()
  broadcastOnSuccess = undefined
})

describe('PortalAccessGate — autoOpenSignin guard', () => {
  it('does NOT call openAuthPopover when reason is "unauthorized"', async () => {
    await act(async () => {
      render(<PortalAccessGate {...baseProps} reason="unauthorized" autoOpenSignin="login" />)
    })
    expect(openAuthPopover).not.toHaveBeenCalled()
  })

  it('DOES call openAuthPopover when reason is "unauthenticated"', async () => {
    await act(async () => {
      render(<PortalAccessGate {...baseProps} reason="unauthenticated" autoOpenSignin="login" />)
    })
    expect(openAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'login' }))
  })
})

describe('PortalAccessGate — callbackUrl', () => {
  it('navigates to callbackUrl after a successful sign-in', async () => {
    render(<PortalAccessGate {...baseProps} callbackUrl="/admin" />)
    await act(async () => {
      broadcastOnSuccess?.()
      await Promise.resolve()
    })
    // navigateAfterAuth is called — not router.navigate directly.
    expect(vi.mocked(navigateAfterAuth)).toHaveBeenCalledWith('/admin', expect.any(Function))
    expect(navigate).not.toHaveBeenCalled()

    // Invoke the clientNavigate callback to cover the portal-local branch.
    const clientNavigate = vi.mocked(navigateAfterAuth).mock.calls[0][1]
    await act(async () => {
      clientNavigate()
      await Promise.resolve()
    })
    expect(invalidate).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: '/admin' })
  })

  it('does not navigate when no callbackUrl is given', async () => {
    render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      broadcastOnSuccess?.()
      await Promise.resolve()
    })
    expect(invalidate).toHaveBeenCalled()
    expect(vi.mocked(navigateAfterAuth)).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
