// @vitest-environment happy-dom
/**
 * The launch plan's "Import from {domain}" lands in Customise with Import
 * open, the website filled in and the import already reading, once. A plain
 * visit starts nothing.
 */
import { StrictMode, type ReactNode } from 'react'
import type { PortalConfig } from '@/lib/shared/types/settings'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { rootContext, importBrand, publish } = vi.hoisted(() => ({
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
  },
  // Still reading for as long as the test looks.
  importBrand: vi.fn((_args: unknown) => new Promise(() => {})),
  publish: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouteContext: ({ select }: { select: (context: typeof rootContext) => unknown }) =>
      select(rootContext),
    useRouter: () => ({ invalidate: vi.fn() }),
    useBlocker: () => ({ status: 'idle' }),
    ClientOnly: () => null,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})
vi.mock('@/lib/server/functions/portal-customise', () => ({
  publishPortalCustomisationFn: publish,
  importBrandFn: importBrand,
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/analytics', () => ({ track: vi.fn() }))
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }))
vi.mock('@/components/admin/upgrade', () => ({ UpgradeModal: () => null }))

const { CustomiseEditor } = await import('../customise-editor')

const pages = [
  { id: 'feedback' as const, label: 'Feedback', path: '/', section: 'welcome' as const },
]

/** What the route hands the editor: the linked website, once. */
function linked(site: string | null) {
  let left = site
  return () => {
    const next = left
    left = null
    return next
  }
}

function editor(take: (() => string | null) | undefined, key = 'first') {
  return (
    <StrictMode>
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <CustomiseEditor
            key={key}
            loaded={{
              theme: { themeMode: 'user' },
              customCss: '',
              portal: {} as PortalConfig,
              helpCenter: null,
              name: 'Acme',
            }}
            pages={pages}
            gatedTypes={new Set()}
            refreshKey="saved"
            takeLinkedImport={take}
          />
        </QueryClientProvider>
      </IntlProvider>
    </StrictMode>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Customise opened from the launch plan', () => {
  it('opens Import with the website filled in and the import already reading', async () => {
    render(editor(linked('acme.example')))
    expect(await screen.findByRole('textbox', { name: 'Your website' })).toHaveValue('acme.example')
    expect(importBrand).toHaveBeenCalledExactlyOnceWith({ data: { url: 'acme.example' } })
    expect(await screen.findByText(/Reading acme\.example/)).toBeVisible()
    // Nothing is published by arriving.
    expect(publish).not.toHaveBeenCalled()
  })

  it('never imports again when the editor mounts a second time', async () => {
    const take = linked('acme.example')
    const view = render(editor(take))
    await screen.findByText(/Reading acme\.example/)
    view.rerender(editor(take, 'second'))
    expect(importBrand).toHaveBeenCalledOnce()
  })

  it('starts nothing on a plain visit: Import stays closed', () => {
    render(editor(linked(null)))
    render(editor(undefined))
    expect(importBrand).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Your website' })).toBeNull()
  })
})
