// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouteContext: () => ({ baseUrl: 'https://feedback.example.com' }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: 'wgt_testsecret' }),
  useQuery: () => ({
    data: {
      useCase: 'product_feedback',
      hasWidgetInstalled: false,
      hasWidgetEnabled: false,
    },
  }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetSecret: () => ({ queryKey: ['settings', 'widgetSecret'] }),
  },
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({ queryKey: ['onboarding'] }),
  },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useRegenerateWidgetSecret: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('WidgetInstallPage', () => {
  it('defaults to a launcher-only snippet and keeps identify off', async () => {
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(
      screen.getByRole('switch', { name: 'Include identify in the snippet and agent prompt' })
    ).not.toBeChecked()
    expect(screen.getByText(/Add the launcher/)).toBeInTheDocument()
    expect(screen.getByText(/Identify signed-in users/)).toBeInTheDocument()
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()

    const snippet = screen.getByText(/anonymous visitors see the launcher/i).closest('code')
    expect(snippet?.textContent).toContain('Quackback("init")')
    expect(snippet?.textContent).not.toContain('ssoToken')
    expect(snippet?.textContent).not.toContain('QUACKBACK_WIDGET_SECRET')
  })
})
