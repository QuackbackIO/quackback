// @vitest-environment happy-dom
/**
 * The widget settings page holds its live preview back until hydration (the
 * iframe and the admin's resolved theme are client-only). Only the preview may
 * render again when that happens: re-rendering the page for it repaints every
 * settings card on the page for nothing. Nor may a hydration that takes a
 * moment fetch again the install status the page was delivered with.
 */
import { act, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cardRenders, previewRenders, fetchOnboardingStatus } = vi.hoisted(() => ({
  cardRenders: new Map<string, number>(),
  previewRenders: { count: 0 },
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
    useRouter: () => ({ invalidate: vi.fn() }),
    useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
      const context = {
        settings: { featureFlags: { feedback: true, changelog: true, supportInbox: true } },
      }
      return opts?.select ? opts.select(context as never) : context
    },
    useChildMatches: () => [],
    Outlet: () => null,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadWidgetHeroImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWidgetHeroImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/admin/settings/settings-card', () => ({
  SettingsCard: ({ title, children }: { title?: string; children?: ReactNode }) => {
    cardRenders.set(title ?? '', (cardRenders.get(title ?? '') ?? 0) + 1)
    return (
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    )
  },
}))

vi.mock('@/components/admin/settings/widget/widget-preview', () => ({
  WidgetPreview: ({ theme }: { theme: string }) => {
    previewRenders.count++
    return <div data-testid="widget-preview" data-theme={theme} />
  },
}))

const { WidgetSettingsGate } =
  await import('@/components/admin/settings/widget/widget-settings-page')

function seededClient(statusAgeMs = 0) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'widgetConfig'], {
    enabled: true,
    position: 'bottom-right',
    tabs: { home: true, messenger: true, feedback: true, changelog: true },
    home: {},
  })
  queryClient.setQueryData(['admin', 'boards'], [])
  queryClient.setQueryData(
    ['admin', 'onboarding'],
    { hasWidgetInstalled: false },
    { updatedAt: Date.now() - statusAgeMs }
  )
  return queryClient
}

afterEach(() => {
  cardRenders.clear()
  previewRenders.count = 0
  fetchOnboardingStatus.mockClear()
  document.body.innerHTML = ''
})

describe('widget settings page hydration', () => {
  it('renders each settings card once and mounts the preview after hydrating', async () => {
    const serverClient = seededClient()
    const html = renderToString(
      <QueryClientProvider client={serverClient}>
        <WidgetSettingsGate />
      </QueryClientProvider>
    )
    expect(html).not.toContain('widget-preview')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    cardRenders.clear()

    const client = seededClient()
    await act(async () => {
      hydrateRoot(
        container,
        <QueryClientProvider client={client}>
          <WidgetSettingsGate />
        </QueryClientProvider>
      )
    })

    // The preview appears, themed like the admin's own (dark) theme.
    const preview = container.querySelector('[data-testid="widget-preview"]')
    expect(preview?.getAttribute('data-theme')).toBe('dark')
    expect(previewRenders.count).toBe(1)

    expect(cardRenders.size).toBeGreaterThanOrEqual(4)
    for (const [title, renders] of cardRenders) {
      expect({ title, renders }).toEqual({ title, renders: 1 })
    }
  })

  it('keeps the install status it was delivered with when hydration takes a moment', async () => {
    // Two seconds between the document's read and the page mounting.
    render(
      <QueryClientProvider client={seededClient(2_000)}>
        <WidgetSettingsGate />
      </QueryClientProvider>
    )
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(fetchOnboardingStatus).not.toHaveBeenCalled()
  })
})
