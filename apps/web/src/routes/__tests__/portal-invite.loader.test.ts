/**
 * Unit tests for the portal-invite.$inviteId route loader.
 *
 * Covers fix #10: the loader must distinguish error kinds instead of
 * mapping everything to not_found.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: unknown) {
        return fn
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const mockAcceptPortalInviteFn = vi.fn()

vi.mock('@/lib/server/functions/portal-invites', () => ({
  acceptPortalInviteFn: (args: unknown) => mockAcceptPortalInviteFn(args),
}))

// TanStack Router redirect — mimic the real throw-based API.
const mockRedirectThrow = vi.fn((opts: { to: string; search?: Record<string, string> }) => {
  const err = Object.assign(new Error('redirect'), { isRedirect: true, ...opts })
  return err
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
  redirect: (opts: { to: string; search?: Record<string, string> }) => {
    return mockRedirectThrow(opts)
  },
}))

// ---------------------------------------------------------------------------
// Route loader helper
// ---------------------------------------------------------------------------

import { Route } from '../portal-invite.$inviteId'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoaderFn = (ctx: any) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

// Helper: call the loader with a given session and inviteId.
async function runLoader(
  inviteId: string,
  session: { user?: { id: string } } | null
): Promise<unknown> {
  try {
    return await loader({ params: { inviteId }, context: { session } })
  } catch (err) {
    return err
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('portal-invite route loader — unauthenticated', () => {
  it('redirects to the sign-in dialog when session is null', async () => {
    const result = await runLoader('invite_1', null)
    const r = result as { isRedirect?: boolean; to?: string; search?: Record<string, string> }
    expect(r.isRedirect).toBe(true)
    expect(r.to).toBe('/')
    expect(r.search?.signin).toBe('1')
  })

  it('redirects to the sign-in dialog when session has no user', async () => {
    const result = await runLoader('invite_1', {})
    const r = result as { isRedirect?: boolean; to?: string; search?: Record<string, string> }
    expect(r.isRedirect).toBe(true)
    expect(r.to).toBe('/')
    expect(r.search?.signin).toBe('1')
  })

  it('includes callbackUrl pointing back to the invite route', async () => {
    const result = await runLoader('invite_abc', null)
    const r = result as { search?: { callbackUrl: string } }
    expect(r.search?.callbackUrl).toBe('/portal-invite/invite_abc')
  })
})

describe('portal-invite route loader — Authentication required error', () => {
  it('redirects to the sign-in dialog when acceptPortalInviteFn throws Authentication required', async () => {
    mockAcceptPortalInviteFn.mockRejectedValue(new Error('Authentication required'))
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    const r = result as { isRedirect?: boolean; to?: string; search?: Record<string, string> }
    expect(r.isRedirect).toBe(true)
    expect(r.to).toBe('/')
    expect(r.search?.signin).toBe('1')
  })
})

describe('portal-invite route loader — PORTAL_INVITE_NOT_FOUND', () => {
  it('returns status=not_found when invite does not exist', async () => {
    mockAcceptPortalInviteFn.mockRejectedValue(new Error('PORTAL_INVITE_NOT_FOUND'))
    const result = await runLoader('invite_missing', { user: { id: 'u1' } })
    expect((result as { status: string }).status).toBe('not_found')
  })
})

describe('portal-invite route loader — email_not_verified', () => {
  it('returns status=email_not_verified when acceptPortalInviteFn returns that status', async () => {
    mockAcceptPortalInviteFn.mockResolvedValue({ status: 'email_not_verified' })
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    expect((result as { status: string }).status).toBe('email_not_verified')
  })
})

describe('portal-invite route loader — unexpected error', () => {
  it('returns status=error (not not_found) for unexpected errors', async () => {
    mockAcceptPortalInviteFn.mockRejectedValue(new Error('Something broke internally'))
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    expect((result as { status: string }).status).toBe('error')
  })

  it('does NOT return status=not_found for unexpected errors', async () => {
    mockAcceptPortalInviteFn.mockRejectedValue(new Error('Unexpected DB error'))
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    expect((result as { status: string }).status).not.toBe('not_found')
  })
})

describe('portal-invite route loader — accepted', () => {
  it('redirects to / when invite is accepted', async () => {
    mockAcceptPortalInviteFn.mockResolvedValue({ status: 'accepted', alreadyAccepted: false })
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    const r = result as { isRedirect?: boolean; to?: string }
    expect(r.isRedirect).toBe(true)
    expect(r.to).toBe('/')
  })

  it('returns mismatch status through', async () => {
    mockAcceptPortalInviteFn.mockResolvedValue({ status: 'mismatch' })
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    expect((result as { status: string }).status).toBe('mismatch')
  })
})
