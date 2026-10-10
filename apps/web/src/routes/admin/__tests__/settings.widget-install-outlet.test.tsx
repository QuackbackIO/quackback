// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const useChildMatches = vi.fn()

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useChildMatches,
    Outlet: () => <div>install-outlet</div>,
    useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
      select({ settings: {} }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({ queryKey: ['w'] }),
    helpCenterConfig: () => ({ queryKey: ['h'] }),
  },
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boards: () => ({ queryKey: ['b'] }),
    onboardingStatus: () => ({ queryKey: ['o'] }),
  },
}))
vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')),
  useSuspenseQuery: () => ({
    data: Object.assign([], { messenger: { enabled: false }, tabs: {}, home: {} }),
  }),
}))
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadWidgetHeroImage: () => ({ mutate: vi.fn() }),
  useDeleteWidgetHeroImage: () => ({ mutate: vi.fn() }),
}))

describe('widget settings child outlet', () => {
  it('renders the install child instead of the general widget page', async () => {
    useChildMatches.mockReturnValue([{ id: '/admin/settings/widget/install' }])
    const { WidgetSettingsGate } =
      await import('@/components/admin/settings/widget/widget-settings-page')
    render(<WidgetSettingsGate />)
    expect(screen.getByText('install-outlet')).toBeTruthy()
    expect(screen.queryByText('Quinn')).toBeNull()
  })

  it('renders the general widget page when there is no child route', async () => {
    useChildMatches.mockReturnValue([])
    const { WidgetSettingsGate } =
      await import('@/components/admin/settings/widget/widget-settings-page')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" defaultLocale="en">
          <WidgetSettingsGate />
        </IntlProvider>
      </QueryClientProvider>
    )
    expect(screen.queryByText('install-outlet')).toBeNull()
    expect(screen.getByText('Quinn')).toBeTruthy()
  })
})
