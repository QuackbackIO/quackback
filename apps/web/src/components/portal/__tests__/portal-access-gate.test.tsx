// @vitest-environment happy-dom
import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const navigate = vi.fn()
const invalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate, invalidate }),
}))

// Capture only GateCard's broadcast onSuccess (no `enabled` prop).
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

// Capture the props the gate hands the inline form (mode etc.).
let formProps: Record<string, unknown> = {}
vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: (props: Record<string, unknown>) => {
    formProps = props
    return <div data-testid="auth-form-body">FORM_BODY</div>
  },
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
  vi.mocked(navigateAfterAuth).mockClear()
  broadcastOnSuccess = undefined
  formProps = {}
})

describe('PortalAccessGate — inline auth form', () => {
  it('renders the auth form directly for an unauthenticated visitor, with no intermediate button', () => {
    render(<PortalAccessGate {...baseProps} />)
    expect(screen.getByTestId('auth-form-body')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in \/ register/i })).not.toBeInTheDocument()
  })

  it('does NOT render the auth form for an unauthorized visitor', () => {
    render(<PortalAccessGate {...baseProps} reason="unauthorized" userEmail="alice@example.com" />)
    expect(screen.queryByTestId('auth-form-body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('seeds the form mode from autoOpenSignin', () => {
    render(<PortalAccessGate {...baseProps} autoOpenSignin="signup" />)
    expect(formProps.mode).toBe('signup')
  })

  it('defaults the form mode to login when autoOpenSignin is absent', () => {
    render(<PortalAccessGate {...baseProps} />)
    expect(formProps.mode).toBe('login')
  })
})

describe('PortalAccessGate — decorative backdrop', () => {
  it('renders an inert, screen-reader-hidden faux board (nothing focusable)', () => {
    render(<PortalAccessGate {...baseProps} />)
    const backdrop = screen.getByTestId('portal-gate-backdrop')
    expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    // The fake board only exists to suggest a real portal sits behind the wall.
    // It must never be tabbable or announced to assistive tech.
    expect(
      backdrop.querySelectorAll('button, a, input, select, textarea, [tabindex]')
    ).toHaveLength(0)
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
