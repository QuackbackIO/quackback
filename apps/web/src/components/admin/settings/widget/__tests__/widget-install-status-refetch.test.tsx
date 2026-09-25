// @vitest-environment happy-dom
/**
 * The install page polls the widget's install status while it waits for the
 * snippet to go live. The status the page's document (or loader) just
 * delivered is fresh: fetching it again the moment the page mounts is a
 * second request for the same answer. A status cached by an earlier visit is
 * still refetched on arrival.
 */
import type { ReactNode } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchOnboardingStatus } = vi.hoisted(() => ({
  fetchOnboardingStatus: vi.fn(async () => ({ hasWidgetInstalled: false })),
}))

vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  fetchOnboardingStatus,
}))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouteContext: () => ({ baseUrl: 'https://feedback.example.com' }),
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@/lib/client/mutations/settings', () => ({
  useRegenerateWidgetSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWidgetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMintWidgetInstallCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const { WidgetInstallPage } = await import('@/components/admin/settings/widget/widget-install-page')

const status = {
  useCase: 'product_feedback',
  hasWidgetInstalled: false,
  hasWidgetEnabled: false,
  widgetOriginHost: null,
  widgetLastDetectedAt: null,
  widgetSdkNeedsUpdate: false,
}

function renderPage(statusAgeMs: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'widgetSecret'], 'wgt_testsecret')
  queryClient.setQueryData(['settings', 'widgetConfig'], { enabled: false })
  queryClient.setQueryData(['admin', 'onboarding'], status, {
    updatedAt: Date.now() - statusAgeMs,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WidgetInstallPage />
    </QueryClientProvider>
  )
}

afterEach(() => fetchOnboardingStatus.mockClear())

describe('widget install page status', () => {
  it('uses the status the page was delivered with instead of refetching it on mount', async () => {
    renderPage(0)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(fetchOnboardingStatus).not.toHaveBeenCalled()
  })

  it('refetches a status cached by an earlier visit', async () => {
    renderPage(60_000)
    await waitFor(() => expect(fetchOnboardingStatus).toHaveBeenCalledTimes(1))
  })
})
