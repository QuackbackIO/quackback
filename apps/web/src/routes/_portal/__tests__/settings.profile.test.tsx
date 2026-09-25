// @vitest-environment happy-dom
/**
 * Portal settings/profile loader.
 *
 * EmailField (rendered by this page) reads the ['email-change-state'] query
 * key, resolving session -> user -> principal -> role from scratch on every
 * mount because it is a separate HTTP request from the document. The loader
 * now pre-fetches that same key alongside the user profile, so both ride the
 * document response the parent _portal layout already pays the session
 * lookup for, and EmailField finds warm data instead of firing its own
 * request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

const fetchUserProfile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  fetchUserProfile: (...args: unknown[]) => fetchUserProfile(...args),
}))

const getEmailChangeStateFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/contact-email', () => ({
  getEmailChangeStateFn: (...args: unknown[]) => getEmailChangeStateFn(...args),
}))

import { Route } from '../settings.profile'

beforeEach(() => {
  fetchUserProfile.mockReset()
  getEmailChangeStateFn.mockReset()
  fetchUserProfile.mockResolvedValue({
    hasPassword: false,
    ssoEnforced: false,
    twoFactorEnabled: false,
  })
  getEmailChangeStateFn.mockResolvedValue({
    currentEmail: 'person@example.com',
    requiresCurrentCode: true,
  })
})

describe('settings/profile loader', () => {
  it("seeds EmailField's own query key, in the same request as the user profile", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const session = { user: { id: 'user_1' as UserId } }

    await (
      Route as unknown as {
        loader: (opts: {
          context: { session: typeof session; queryClient: QueryClient }
        }) => Promise<unknown>
      }
    ).loader({ context: { session, queryClient } })

    expect(getEmailChangeStateFn).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(['email-change-state'])).toEqual({
      currentEmail: 'person@example.com',
      requiresCurrentCode: true,
    })
  })
})
