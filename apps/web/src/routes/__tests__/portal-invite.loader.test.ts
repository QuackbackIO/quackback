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
  createServerOnlyFn: <T>(fn: T) => fn,
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

// The REAL redirect: a `Response` carrying `options`, with no `isRedirect`
// property. A hand-made `{ isRedirect: true }` stand-in hid a loader that only
// re-threw objects with that property, so every successful accept rendered
// "Something went wrong" instead of landing on the portal.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))

import { isRedirect } from '@tanstack/react-router'

/** The navigation a thrown redirect asks for, or null when it is not one. */
function redirectOf(value: unknown): { to?: string; search?: Record<string, string> } | null {
  if (!isRedirect(value)) return null
  return value.options as { to?: string; search?: Record<string, string> }
}

// ---------------------------------------------------------------------------
// Route loader helper
// ---------------------------------------------------------------------------

import { Route } from '../portal-invite.$inviteId'

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
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
    const r = redirectOf(result)
    expect(r).not.toBeNull()
    expect(r?.to).toBe('/')
    expect(r?.search?.auth).toBe('signin')
  })

  it('redirects to the sign-in dialog when session has no user', async () => {
    const result = await runLoader('invite_1', {})
    const r = redirectOf(result)
    expect(r).not.toBeNull()
    expect(r?.to).toBe('/')
    expect(r?.search?.auth).toBe('signin')
  })

  it('includes callbackUrl pointing back to the invite route', async () => {
    const result = await runLoader('invite_abc', null)
    const r = redirectOf(result)
    expect(r?.search?.callbackUrl).toBe('/portal-invite/invite_abc')
  })
})

describe('portal-invite route loader — Authentication required error', () => {
  it('redirects to the sign-in dialog when acceptPortalInviteFn throws Authentication required', async () => {
    mockAcceptPortalInviteFn.mockRejectedValue(new Error('Authentication required'))
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    const r = redirectOf(result)
    expect(r).not.toBeNull()
    expect(r?.to).toBe('/')
    expect(r?.search?.auth).toBe('signin')
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
    const r = redirectOf(result)
    expect(r).not.toBeNull()
    expect(r?.to).toBe('/')
  })

  it('returns mismatch status through', async () => {
    mockAcceptPortalInviteFn.mockResolvedValue({ status: 'mismatch' })
    const result = await runLoader('invite_1', { user: { id: 'u1' } })
    expect((result as { status: string }).status).toBe('mismatch')
  })
})
