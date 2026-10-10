// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render as baseRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const render = (node: React.ReactElement) =>
  baseRender(
    <IntlProvider locale="en" defaultLocale="en">
      {node}
    </IntlProvider>
  )

const { onboarding, mintInstallCode, toast, copyWithFallback } = vi.hoisted(() => ({
  onboarding: {
    useCase: 'product_feedback',
    hasWidgetInstalled: false,
    hasWidgetEnabled: false,
    widgetOriginHost: null as string | null,
    widgetLastDetectedAt: null as string | null,
    widgetSdkNeedsUpdate: false,
  },
  mintInstallCode: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  toast: { success: vi.fn(), error: vi.fn() },
  copyWithFallback: vi.fn(),
}))

const queryClient = new (await import('@tanstack/react-query')).QueryClient()

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
      const context = { baseUrl: 'https://feedback.example.com' }
      return opts?.select ? opts.select(context as never) : context
    },
    Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
      <a href={to}>{children}</a>
    ),
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: () => ({ data: 'wgt_testsecret' }),
  useQuery: () => ({
    data: onboarding,
  }),
  useQueryClient: () => queryClient,
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
  useMintWidgetInstallCode: () => mintInstallCode,
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: (...args: unknown[]) => copyWithFallback(...args),
}))

vi.mock('sonner', () => ({
  toast,
}))

describe('WidgetInstallPage', () => {
  beforeEach(() => {
    onboarding.hasWidgetInstalled = false
    onboarding.hasWidgetEnabled = false
    onboarding.widgetOriginHost = null
    mintInstallCode.mutateAsync.mockReset()
    mintInstallCode.mutateAsync.mockResolvedValue({
      code: 'qbi_pagepairingcode',
    })
    copyWithFallback.mockReset()
    copyWithFallback.mockResolvedValue(undefined)
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('shows setup steps and keeps the signing secret out of the numbered flow', async () => {
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    expect(screen.queryByRole('switch', { name: /identify/i })).toBeNull()
    expect(screen.getByText(/Copy the prompt for your agent/)).toBeInTheDocument()
    expect(screen.getByText(/Open a page on your site/)).toBeInTheDocument()
    expect(screen.getByText(/Install without an agent/)).toBeInTheDocument()
    expect(screen.getByText(/Skip this unless you are installing by hand/)).toBeInTheDocument()
    expect(screen.queryByText('3. Signing secret')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy install prompt' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Signing secret/ }))
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()
  })

  it('shows identify comments in the hand-install snippet after opening it', async () => {
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    fireEvent.click(screen.getByRole('button', { name: /Install without an agent/ }))

    const snippet = screen.getByText(/Init first so anonymous visitors/i).closest('code')
    expect(snippet?.textContent).toContain('ssoToken')
    expect(snippet?.textContent).toContain('Quackback("init")')
    expect(snippet?.textContent).not.toContain('QUACKBACK_WIDGET_SECRET')
    expect(snippet?.textContent).not.toContain('wgt_testsecret')
  })

  it('has no visibility switch and links back to Widget settings', async () => {
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    expect(screen.queryByRole('switch', { name: 'Show on your website' })).toBeNull()
    expect(screen.getByText('Show on your website')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Widget settings' })).toBeInTheDocument()
  })

  it('titles the page Install under a Widget breadcrumb', async () => {
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    expect(screen.getByRole('heading', { name: 'Install' })).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs).toHaveTextContent('Widget')
  })

  it('mints a pairing code into the agent prompt and never copies a wgt_ secret', async () => {
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy install prompt' }))

    await waitFor(() => {
      expect(mintInstallCode.mutateAsync).toHaveBeenCalled()
      expect(copyWithFallback).toHaveBeenCalled()
    })
    const copied = copyWithFallback.mock.calls[0][0] as string
    expect(copied).toContain('qbi_pagepairingcode')
    expect(copied).toContain('/api/widget/install-context')
    expect(copied).toContain('If this app has login')
    expect(copied).not.toContain('wgt_testsecret')
    expect(copied).not.toMatch(/wgt_[A-Za-z0-9]/)
    expect(copied).not.toContain('Do not implement identify')
  })

  it('switches to a manage layout once the SDK has been seen', async () => {
    onboarding.hasWidgetInstalled = true
    onboarding.hasWidgetEnabled = true
    onboarding.widgetOriginHost = 'app.example.com'
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    expect(screen.getByRole('heading', { name: 'Install' })).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Add to another site')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByText('1. Copy the prompt for your agent')).toBeNull()
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()
  })

  it('flags a detected but hidden install as needing attention', async () => {
    onboarding.hasWidgetInstalled = true
    const { WidgetInstallPage } =
      await import('@/components/admin/settings/widget/widget-install-page')
    render(<WidgetInstallPage />)

    expect(screen.getByText(/Turn on Show on your website so visitors/)).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })
})
