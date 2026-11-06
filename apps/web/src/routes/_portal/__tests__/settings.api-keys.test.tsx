// @vitest-environment happy-dom
/**
 * /settings/api-keys is for team members only: a portal user is sent to their
 * profile before the page loads, and the account nav shows the tab only to
 * team members.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
  redirect: (options: unknown) => ({ redirect: options }),
  useRouterState: () => '/settings/profile',
  useHydrated: () => true,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('@/lib/server/functions/personal-api-keys', () => ({
  fetchMyApiKeysFn: vi.fn(async () => ({ keys: [], canCreate: true })),
}))
vi.mock('@/components/settings/api-keys/personal-api-keys', () => ({ PersonalApiKeys: () => null }))

const { Route } = await import('../settings.api-keys')
const { SettingsNav } = await import('@/components/settings/settings-nav')

type Loader = (args: {
  context: { userRole?: string | null; acceptLanguageLocale?: string }
}) => Promise<unknown>

afterEach(cleanup)

describe('/settings/api-keys', () => {
  it.each(['user', null])('sends a %s to their profile', async (userRole) => {
    const loader = (Route as unknown as { loader: Loader }).loader
    await expect(loader({ context: { userRole } })).rejects.toBeTruthy()
  })

  it.each(['admin', 'member'])('lets a %s in', async (userRole) => {
    const loader = (Route as unknown as { loader: Loader }).loader
    await expect(loader({ context: { userRole } })).resolves.toMatchObject({ canCreate: true })
  })

  it('shows the API keys tab only to team members', () => {
    const { rerender } = render(
      <IntlProvider locale="en">
        <SettingsNav />
      </IntlProvider>
    )
    expect(screen.queryByText('API keys')).toBeNull()
    rerender(
      <IntlProvider locale="en">
        <SettingsNav showApiKeys />
      </IntlProvider>
    )
    expect(screen.getByRole('link', { name: 'API keys' })).toHaveAttribute(
      'href',
      '/settings/api-keys'
    )
  })
})
