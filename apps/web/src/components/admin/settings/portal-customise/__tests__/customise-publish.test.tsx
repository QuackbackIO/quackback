// @vitest-environment happy-dom
/**
 * Customise publishes through the one atomic publish: theme, Advanced CSS,
 * tabs and welcome message in one call. A failed publish shows one "Couldn't
 * save" toast, from the shared autosave handler; a plan refusal and someone
 * else's change open dialogs instead. A publish says where it went live.
 */
import { act, type ReactNode } from 'react'
import type { PortalConfig } from '@/lib/shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { toast, rootContext, saveFails, saveError, publish } = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
  },
  saveFails: { value: true },
  saveError: { value: new Error('nope') as Error },
  publish: {
    fn: null as unknown as import('vitest').Mock,
    conflict: false,
  },
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
    useBlocker: () => ({ status: 'idle' }),
    ClientOnly: () => null,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

// The real publish hook runs against a failing server function, so its own
// `meta` decides what the shared handler shows.
publish.fn = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
  if (saveFails.value) throw saveError.value
  if (publish.conflict)
    return {
      ok: false,
      code: 'SETTINGS_CHANGED',
      message: 'Someone else changed these settings. Reload the page to see their changes.',
      parts: ['portal.welcomeCard'],
      current: { portal: { welcomeCard: null } },
    }
  const { before: _before, ...parts } = data
  return { ok: true, parts: Object.keys(parts), published: parts }
})
vi.mock('@/lib/server/functions/portal-customise', () => ({
  publishPortalCustomisationFn: (args: { data: Record<string, unknown> }) => publish.fn(args),
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
const { CustomiseEditor } = await import('../customise-editor')

const pages = [
  { id: 'feedback' as const, label: 'Feedback', path: '/', section: 'welcome' as const },
]

function renderPage() {
  const queryClient = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={queryClient}>
        <CustomiseEditor
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
        />
      </QueryClientProvider>
    </IntlProvider>
  )
  // The sections these tests edit, opened as an admin would.
  fireEvent.click(screen.getByRole('button', { name: /^Welcome message/ }))
  return view
}

function chooseMode(name: 'Light' | 'Dark') {
  if (!screen.queryByRole('radio', { name })) {
    fireEvent.click(screen.getByRole('button', { name: /^Colours/ }))
  }
  fireEvent.click(screen.getByRole('radio', { name }))
}

afterEach(() => {
  toast.error.mockClear()
  toast.success.mockClear()
  publish.fn.mockClear()
  publish.conflict = false
  saveFails.value = true
  saveError.value = new Error('nope')
})

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  })
  // Let every queued handler run before counting toasts.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function saveWelcomeEdit() {
  if (!screen.queryByTestId('rich-text-editor')) {
    fireEvent.click(screen.getByRole('button', { name: /^Welcome message/ }))
  }
  act(() => {
    fireEvent.click(screen.getByTestId('rich-text-editor'))
  })
  await save()
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

  it('says where it went live when the save works', async () => {
    saveFails.value = false
    renderPage()
    act(() => {
      fireEvent.click(screen.getByTestId('rich-text-editor'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    // The publish settles once the settings it touched are read again.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(`Published. Live on ${window.location.host}.`)
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('publishes the theme, Advanced CSS and welcome message in one call, with what it loaded as before', async () => {
    saveFails.value = false
    renderPage()
    act(() => {
      fireEvent.click(screen.getByTestId('rich-text-editor'))
    })
    chooseMode('Dark')
    await save()
    expect(publish.fn).toHaveBeenCalledOnce()
    const { data } = publish.fn.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data).toMatchObject({
      before: {
        theme: { themeMode: 'user' },
        customCss: '',
        portal: { welcomeCard: null },
      },
      theme: { themeMode: 'dark' },
      customCss: '',
      portal: { welcomeCard: { body: { type: 'doc' } } },
    })
    expect(data.portal).not.toHaveProperty('nav')
  })

  it('sends what it just published as before on the next save, without a reload', async () => {
    saveFails.value = false
    renderPage()
    chooseMode('Dark')
    await save()
    chooseMode('Light')
    await save()
    expect(publish.fn).toHaveBeenCalledTimes(2)
    type Sent = { data: { theme: unknown; customCss: unknown; before: unknown } }
    const first = (publish.fn.mock.calls[0]![0] as Sent).data
    const second = (publish.fn.mock.calls[1]![0] as Sent).data
    expect(second.before).toEqual({ theme: first.theme, customCss: first.customCss })
  })

  it('asks what to do when someone else changed a part it publishes', async () => {
    saveFails.value = false
    publish.conflict = true
    renderPage()
    await saveWelcomeEdit()
    expect(toast.error).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Someone else changed these settings')
    expect(dialog.textContent).toContain('Welcome message')
  })
})
