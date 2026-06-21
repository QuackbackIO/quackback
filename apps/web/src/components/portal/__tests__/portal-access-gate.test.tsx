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

import { PortalAccessGate } from '../portal-access-gate'

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
  broadcastOnSuccess = undefined
})

describe('PortalAccessGate — callbackUrl', () => {
  it('navigates to callbackUrl after a successful sign-in', async () => {
    render(<PortalAccessGate {...baseProps} callbackUrl="/admin" />)
    await act(async () => {
      broadcastOnSuccess?.()
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
    expect(navigate).not.toHaveBeenCalled()
  })
})
