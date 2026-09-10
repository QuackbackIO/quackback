// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { onboarding, updateWidgetConfig, toast } = vi.hoisted(() => ({
  onboarding: {
    useCase: 'product_feedback',
    hasWidgetInstalled: false,
    hasWidgetEnabled: false,
    widgetOriginHost: null as string | null,
    widgetLastDetectedAt: null as string | null,
    widgetSdkNeedsUpdate: false,
  },
  updateWidgetConfig: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))

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
  useSuspenseQuery: (opts: { queryKey?: string[] }) => {
    if (opts?.queryKey?.[1] === 'widgetConfig') return { data: { enabled: false } }
    return { data: 'wgt_testsecret' }
  },
  useQuery: () => ({
    data: onboarding,
  }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetSecret: () => ({ queryKey: ['settings', 'widgetSecret'] }),
    widgetConfig: () => ({ queryKey: ['settings', 'widgetConfig'] }),
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
  useUpdateWidgetConfig: () => updateWidgetConfig,
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast,
}))

describe('WidgetInstallPage', () => {
  beforeEach(() => {
    onboarding.hasWidgetInstalled = false
    onboarding.hasWidgetEnabled = false
    updateWidgetConfig.mutateAsync.mockReset()
    updateWidgetConfig.mutateAsync.mockResolvedValue({ enabled: true })
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('defaults to a launcher-only snippet and keeps identify off', async () => {
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(
      screen.getByRole('switch', { name: 'Add identify steps to the snippet and prompt' })
    ).not.toBeChecked()
    expect(screen.getByText(/Add the launcher/)).toBeInTheDocument()
    expect(screen.getByText(/Identify signed-in users/)).toBeInTheDocument()
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()

    const snippet = screen.getByText(/anonymous visitors see the launcher/i).closest('code')
    expect(snippet?.textContent).toContain('Quackback("init")')
    expect(snippet?.textContent).not.toContain('ssoToken')
    expect(snippet?.textContent).not.toContain('QUACKBACK_WIDGET_SECRET')
  })

  it('adds identify comments to the snippet when the switch is on', async () => {
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    fireEvent.click(
      screen.getByRole('switch', { name: 'Add identify steps to the snippet and prompt' })
    )

    const snippet = screen.getByText(/Init first so anonymous visitors/i).closest('code')
    expect(snippet?.textContent).toContain('ssoToken')
    expect(snippet?.textContent).not.toContain('QUACKBACK_WIDGET_SECRET')
  })

  it('toasts when Show on your website fails to save', async () => {
    updateWidgetConfig.mutateAsync.mockRejectedValue(new Error('nope'))
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    fireEvent.click(screen.getByRole('switch', { name: 'Show on your website' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not update widget visibility')
    })
    expect(screen.getByRole('switch', { name: 'Show on your website' })).not.toBeChecked()
  })

  it('points a detected install at the toggle on this page', async () => {
    onboarding.hasWidgetInstalled = true
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(screen.getByText(/Turn on Show on your website above/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Widget settings' })).toBeNull()
  })
})
