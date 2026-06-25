// @vitest-environment happy-dom
import { useEffect } from 'react'
import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const invalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate: vi.fn(), invalidate }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// Hoisted so the spy exists when the (hoisted) mock factory runs.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({ signOut }))

let broadcastOnSuccess: (() => void) | undefined
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: (opts: { onSuccess?: () => void; enabled?: boolean }) => {
    if (!('enabled' in opts)) broadcastOnSuccess = opts.onSuccess
  },
  postAuthSuccess: vi.fn(),
}))

vi.mock('@/lib/client/post-auth-navigation', () => ({ navigateAfterAuth: vi.fn() }))

// The form reports its current step on mount so the gate can track it for the
// 2FA-abandon revoke. Mirrors how AuthDialog drives its formContext in tests.
let stepToReport = 'credentials'
vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: ({
    onContextChange,
  }: {
    onContextChange?: (c: { step: string; email: string }) => void
  }) => {
    useEffect(() => {
      onContextChange?.({ step: stepToReport, email: '' })
    }, [onContextChange])
    return <div data-testid="auth-form-body" />
  },
}))

import { PortalAccessGate } from '../portal-access-gate'

const baseProps = {
  reason: 'unauthenticated' as const,
  workspaceName: 'Acme',
  logoUrl: null,
  authConfig: { found: true, oauth: { password: true } },
  themeStyles: '',
  customCss: '',
  userEmail: null,
  locale: 'en' as const,
}

beforeEach(() => {
  signOut.mockReset()
  signOut.mockResolvedValue(undefined) // gate calls `void signOut().catch(...)`
  stepToReport = 'credentials'
  broadcastOnSuccess = undefined
})

// The modal revokes the just-created session if a required-2FA visitor abandons
// mid-enrollment. The inline form has no "close", so the gate must revoke on
// unmount-while-mid-2FA to keep the same guarantee — otherwise a password-
// authenticated-but-2FA-incomplete session survives and bypasses the policy.
describe('PortalAccessGate — 2FA abandon', () => {
  it('revokes the session when unmounted mid 2FA enrollment', async () => {
    stepToReport = 'two-factor-enroll'
    const { unmount } = render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      unmount()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('revokes the session when unmounted mid 2FA challenge', async () => {
    stepToReport = 'two-factor-challenge'
    const { unmount } = render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      unmount()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('does NOT revoke when unmounted on a normal step', async () => {
    stepToReport = 'credentials'
    const { unmount } = render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      unmount()
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does NOT revoke when unmounting after a successful sign-in', async () => {
    // A completed 2FA flow broadcasts success (latching the signing-in state),
    // then the gate unmounts as access is granted — that session is legitimate.
    stepToReport = 'two-factor-enroll'
    const { unmount } = render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      broadcastOnSuccess?.()
      await Promise.resolve()
    })
    await act(async () => {
      unmount()
    })
    expect(signOut).not.toHaveBeenCalled()
  })
})
