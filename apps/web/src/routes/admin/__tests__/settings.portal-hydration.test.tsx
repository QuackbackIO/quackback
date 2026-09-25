// @vitest-environment happy-dom
/**
 * The portal settings page holds its live preview iframe back until
 * hydration. Only the preview may render again when that happens:
 * re-rendering the page for it repaints the theme controls, the navigation
 * editor and the welcome message editor for nothing.
 */
import { act, type ComponentType, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cardRenders, previewRenders } = vi.hoisted(() => ({
  cardRenders: new Map<string, number>(),
  previewRenders: { count: 0 },
}))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({
      options,
      useRouteContext: () => ({
        settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
        session: null,
      }),
    }),
    useRouter: () => ({ invalidate: vi.fn() }),
    useBlocker: () => undefined,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdatePortalConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveBrandingTheme: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}))

vi.mock('@/components/admin/upgrade', () => ({ UpgradeModal: () => null }))

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

vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: () => {
    previewRenders.count++
    return <div data-testid="portal-preview" />
  },
}))

const { Route } = await import('@/routes/admin/settings.portal')
const PortalPage = (Route as unknown as { options: { component: ComponentType } }).options.component

function seededClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'branding'], { themeMode: 'user' })
  queryClient.setQueryData(['settings', 'logo'], { url: null })
  queryClient.setQueryData(['settings', 'customCss'], '')
  queryClient.setQueryData(['settings', 'portalConfig'], {})
  return queryClient
}

afterEach(() => {
  cardRenders.clear()
  previewRenders.count = 0
  document.body.innerHTML = ''
})

describe('portal settings page hydration', () => {
  async function hydratePage() {
    const html = renderToString(
      <QueryClientProvider client={seededClient()}>
        <PortalPage />
      </QueryClientProvider>
    )
    expect(html).not.toContain('portal-preview')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    cardRenders.clear()

    await act(async () => {
      hydrateRoot(
        container,
        <QueryClientProvider client={seededClient()}>
          <PortalPage />
        </QueryClientProvider>
      )
    })

    return container
  }

  it('renders each settings card once and mounts the preview after hydrating', async () => {
    const container = await hydratePage()

    expect(container.querySelector('[data-testid="portal-preview"]')).toBeTruthy()
    expect(previewRenders.count).toBe(1)

    expect([...cardRenders.keys()]).toEqual(['Appearance', 'Navigation', 'Welcome message'])
    for (const [title, renders] of cardRenders) {
      expect({ title, renders }).toEqual({ title, renders: 1 })
    }
    // Nothing is unsaved: the save bar stays hidden.
    const saveBar = container.querySelector('[role="region"][aria-live="polite"]')!
    expect(saveBar.className).toContain('invisible')
  })
})
