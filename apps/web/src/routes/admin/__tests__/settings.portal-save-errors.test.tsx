// @vitest-environment happy-dom
/**
 * A failed portal save shows one "Couldn't save" toast, from the shared
 * autosave handler. The page adds no toast of its own, and no success toast.
 */
import { act, type ComponentType, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { toast, rootContext, saveFails, saveError } = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
  },
  saveFails: { value: true },
  saveError: { value: new Error('nope') as Error },
}))

vi.mock('sonner', () => ({ toast }))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
    useRouteContext: ({ select }: { select: (context: typeof rootContext) => unknown }) =>
      select(rootContext),
    useRouter: () => ({ invalidate: vi.fn() }),
    useBlocker: () => undefined,
    ClientOnly: () => null,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

// The real portal-config hook runs against a failing server function, so its own
// `meta` decides what the shared handler shows.
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  updatePortalConfigFn: vi.fn(async () => {
    if (saveFails.value) throw saveError.value
  }),
}))

vi.mock('@/lib/client/mutations/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/mutations/settings')>()),
  useSaveBrandingTheme: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onDocumentChange,
  }: {
    onDocumentChange: (d: { json(): unknown }) => void
  }) => (
    <button
      data-testid="rich-text-editor"
      onClick={() =>
        onDocumentChange({
          json: () => ({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
          }),
        })
      }
    />
  ),
}))

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeModal: ({ open }: { open: boolean }) => (open ? <div role="dialog">Upgrade</div> : null),
}))

const { createAutosaveMutationCache } = await import('@/lib/client/autosave')
const { Route } = await import('@/routes/admin/settings.portal')
const PortalPage = (Route as unknown as { options: { component: ComponentType } }).options.component

function renderPage() {
  const queryClient = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['settings', 'branding'], { themeMode: 'user' })
  queryClient.setQueryData(['settings', 'logo'], { url: null })
  queryClient.setQueryData(['settings', 'customCss'], '')
  queryClient.setQueryData(['settings', 'portalConfig'], {})
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={queryClient}>
        <PortalPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(() => {
  toast.error.mockClear()
  toast.success.mockClear()
  saveFails.value = true
  saveError.value = new Error('nope')
})

async function saveWelcomeEdit() {
  act(() => {
    fireEvent.click(screen.getByTestId('rich-text-editor'))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
  // Let every queued handler run before counting toasts.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe('portal save feedback', () => {
  it('shows exactly one error toast when the save fails', async () => {
    renderPage()
    await saveWelcomeEdit()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't save. nope")
  })

  it('names the reason when the server rejects the content', async () => {
    saveError.value = new Error('Link URLs need a full https:// address.')
    renderPage()
    await saveWelcomeEdit()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't save. Link URLs need a full https:// address."
    )
  })

  it('leaves a plan refusal to the upgrade dialog, with no toast', async () => {
    saveError.value = Object.assign(new Error('Upgrade to Business to enable it.'), {
      statusCode: 402,
    })
    renderPage()
    await saveWelcomeEdit()
    expect(screen.getByRole('dialog').textContent).toBe('Upgrade')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows no success toast when the save works', async () => {
    saveFails.value = false
    renderPage()
    act(() => {
      fireEvent.click(screen.getByTestId('rich-text-editor'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
