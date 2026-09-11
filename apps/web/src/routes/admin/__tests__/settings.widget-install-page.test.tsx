// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { onboarding, updateWidgetConfig, mintInstallCode, toast, copyWithFallback } = vi.hoisted(
  () => ({
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
    mintInstallCode: {
      mutateAsync: vi.fn(),
      isPending: false,
    },
    toast: { success: vi.fn(), error: vi.fn() },
    copyWithFallback: vi.fn(),
  })
)

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
    updateWidgetConfig.mutateAsync.mockReset()
    updateWidgetConfig.mutateAsync.mockResolvedValue({ enabled: true })
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
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(screen.queryByRole('switch', { name: /identify/i })).toBeNull()
    expect(screen.getByText(/Copy the prompt for your agent/)).toBeInTheDocument()
    expect(screen.getByText(/Open a page on your site/)).toBeInTheDocument()
    expect(screen.getByText(/Install without an agent/)).toBeInTheDocument()
    expect(screen.getByText(/Skip this unless you are installing by hand/)).toBeInTheDocument()
    expect(screen.queryByText('3. Signing secret')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Signing secret/ }))
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()
  })

  it('shows identify comments in the hand-install snippet after opening it', async () => {
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    fireEvent.click(screen.getByRole('button', { name: /Install without an agent/ }))

    const snippet = screen.getByText(/Init first so anonymous visitors/i).closest('code')
    expect(snippet?.textContent).toContain('ssoToken')
    expect(snippet?.textContent).toContain('Quackback("init")')
    expect(snippet?.textContent).not.toContain('QUACKBACK_WIDGET_SECRET')
    expect(snippet?.textContent).not.toContain('wgt_testsecret')
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

  it('mints a pairing code into the agent prompt and never copies a wgt_ secret', async () => {
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    )

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
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(screen.getByText('Widget on your site')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Add to another site')).toBeInTheDocument()
    expect(screen.getByText(/Widget connection verified/)).toBeInTheDocument()
    expect(screen.queryByText('1. Copy the prompt for your agent')).toBeNull()
    expect(screen.getByTestId('signing-secret')).toBeInTheDocument()
  })

  it('points a detected install at the visibility toggle', async () => {
    onboarding.hasWidgetInstalled = true
    const { WidgetInstallPage } = await import('../settings.widget.install')
    render(<WidgetInstallPage />)

    expect(screen.getByText(/Turn on Show on your website so visitors/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Widget settings' })).toBeNull()
  })
})
