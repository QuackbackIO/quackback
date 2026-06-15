// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

// Capture the GateCard's auth-broadcast onSuccess so the test can fire it as if
// a sign-in just completed, and hand the router a controllable invalidate so we
// can drive the post-login refetch window open and closed deterministically.
const hoisted = vi.hoisted(() => ({
  gateOnSuccess: null as null | (() => void),
  resolveInvalidate: null as null | (() => void),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: () =>
      new Promise<void>((resolve) => {
        hoisted.resolveInvalidate = resolve
      }),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// GateCard subscribes without an `enabled` flag; the nested AuthDialog passes
// one — use that to grab the gate's handler specifically.
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: (opts: { onSuccess?: () => void; enabled?: boolean }) => {
    if (opts && !('enabled' in opts)) hoisted.gateOnSuccess = opts.onSuccess ?? null
  },
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

// The dialog body pulls in the full auth form (server fns, OTP, etc.); stub it.
vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: () => <div data-testid="auth-form-body" />,
}))

import { PortalAccessGate } from '../portal-access-gate'

const authConfig = { found: true, oauth: { password: true, magicLink: true } }

function renderGate() {
  return render(
    <PortalAccessGate
      reason="unauthenticated"
      workspaceName="Acme Corp"
      logoUrl={null}
      authConfig={authConfig}
      themeStyles=""
      customCss=""
      userEmail={null}
    />
  )
}

const cta = () => screen.queryByRole('button', { name: /sign in \/ register/i })

describe('PortalAccessGate — post-sign-in bridge', () => {
  beforeEach(() => {
    hoisted.gateOnSuccess = null
    hoisted.resolveInvalidate = null
    vi.clearAllMocks()
  })
  afterEach(() => cleanup())

  // After a successful sign-in the _portal loader re-runs (router.invalidate).
  // While that refetch is in flight the gate stays mounted, so it must show a
  // transitional state instead of flashing its "Sign in / Register" CTA back —
  // mirrors the PortalHeader "Signing in…" bridge (#249).
  it('swaps the Sign in / Register CTA for a Signing in… state during the post-login refetch', () => {
    renderGate()

    expect(cta()).toBeInTheDocument()
    expect(screen.queryByText(/signing in/i)).not.toBeInTheDocument()

    expect(typeof hoisted.gateOnSuccess).toBe('function')
    act(() => {
      hoisted.gateOnSuccess?.()
    })

    expect(cta()).not.toBeInTheDocument()
    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
  })

  // Regression: when the refetch *resolves*, the gate must not flash the CTA
  // back for a frame before it unmounts (access granted) or re-renders into the
  // unauthorized branch. The transitional state holds until the gate goes away.
  it('does not flash the CTA back when the post-login refetch resolves', async () => {
    renderGate()
    expect(typeof hoisted.gateOnSuccess).toBe('function')

    act(() => {
      hoisted.gateOnSuccess?.()
    })
    expect(cta()).not.toBeInTheDocument()

    // The loader finishes — drive the invalidate promise to resolution and let
    // any resulting state updates flush.
    await act(async () => {
      hoisted.resolveInvalidate?.()
      await Promise.resolve()
    })

    expect(cta()).not.toBeInTheDocument()
    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
  })
})
