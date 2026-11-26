// @vitest-environment happy-dom
/**
 * An anonymous identify on top of a signed-in person is a sign-out: the
 * person's session is dropped and every identity-keyed read starts over, so
 * nothing fetched for them (segment-gated changelog entries, their tickets)
 * feeds the anonymous visitor's badge markers.
 */
import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken, getWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/client/widget-frame', () => ({ frameHasHost: () => true }))

// A segment-gated entry only the signed-in person sees, newer than the public one.
const GATED = '2026-11-25T10:00:00.000Z'
const PUBLIC = '2026-11-01T10:00:00.000Z'
vi.mock('@/lib/server/functions/widget/changelog', () => ({
  widgetListPublicChangelogsFn: ({ headers }: { headers: Record<string, string> }) => {
    const signedIn = headers.Authorization === 'Bearer tok_a'
    const at = signedIn ? GATED : PUBLIC
    return Promise.resolve({
      items: [
        { id: `changelog_${at}`, title: 'Entry', content: '', publishedAt: at, categories: [] },
      ],
      nextCursor: null,
    })
  },
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { WidgetAuthProvider, useWidgetAuth } from '../widget-auth-provider'
import { useChangelogUnread } from '../use-changelog-unread'

function Probe() {
  const { sessionVersion, user, identityResolved } = useWidgetAuth()
  useChangelogUnread(true)
  return (
    <span data-testid="probe">
      {identityResolved ? (user?.id ?? 'anonymous') : 'pending'}:{sessionVersion}
    </span>
  )
}

function postIdentify(data: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:identify', data },
        source: window.parent,
      })
    )
  })
}

beforeEach(() => {
  clearWidgetToken()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

it('an anonymous identify after a signed-in person starts a new session', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionToken: 'tok_a',
        user: { id: 'user_a', name: 'A', email: 'a@example.com', avatarUrl: null },
      }),
    })
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider portalSessionToken={null} portalUser={null}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )

  postIdentify({ id: 'user_a', ssoToken: 'sso' })
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^user_a:/))
  await waitFor(() =>
    expect(window.localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(GATED)
  )
  const versionA = Number(screen.getByTestId('probe').textContent!.split(':')[1])

  postIdentify({ anonymous: true })
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^anonymous:/))
  expect(Number(screen.getByTestId('probe').textContent!.split(':')[1])).toBeGreaterThan(versionA)
  expect(getWidgetToken()).toBeNull()

  // The anonymous visitor's baseline comes from their own list, never from
  // the entries the signed-in person could see.
  await waitFor(() =>
    expect(window.localStorage.getItem('quackback:changelog-seen-at:anonymous')).toBe(PUBLIC)
  )
})
