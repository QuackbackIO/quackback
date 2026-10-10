// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const invalidate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate }),
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  }
})

const portalConfig = {
  features: { allowAnonymous: true },
  moderationDefault: { requireApproval: 'none', holdImages: false, holdLinks: false },
}
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return { ...actual, useSuspenseQuery: () => ({ data: portalConfig }) }
})

const mutateAsync = vi.fn()
vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateModerationDefault: () => ({ mutateAsync }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { portalConfig: () => ({ queryKey: ['portal'] }) },
}))

const { ModerationPage } = await import('@/components/admin/settings/moderation-settings-page')

function renderPage() {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>
        <ModerationPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({})
  invalidate.mockReset()
})
afterEach(cleanup)

describe('Moderation page', () => {
  it('has the standard header, with no breadcrumb of its own and a link to the review queue', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Moderation' })).toBeInTheDocument()
    // The settings layout titles it with its module and shows the module's tabs.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    const queue = screen.getByRole('link', { name: /open queue/i })
    expect(queue.getAttribute('href')).toBe('/admin/feedback/moderation')
  })

  it('keeps approval and content-review cards as shared setting rows', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Approval' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Content review' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Anonymous access' })).not.toBeInTheDocument()

    expect(screen.getByLabelText('Anonymous posts')).toBeInTheDocument()
    expect(screen.getByLabelText('Signed-in posts')).toBeInTheDocument()
    expect(screen.getByLabelText('Images')).toBeInTheDocument()
    expect(screen.getByLabelText('Links')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="setting-row"]')).toHaveLength(4)
  })

  it('saves a toggle immediately and lets the autosave handler report failures', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Anonymous posts'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ requireApproval: 'anonymous' }))
  })

  it('flips the switch at once and reverts it when the save fails', async () => {
    let reject!: (e: Error) => void
    mutateAsync.mockReturnValue(new Promise((_, r) => (reject = r)))
    renderPage()
    const images = screen.getByLabelText('Images')
    expect(images).not.toBeChecked()
    fireEvent.click(images)
    await waitFor(() => expect(images).toBeChecked())
    await act(async () => reject(new Error('boom')))
    await waitFor(() => expect(images).not.toBeChecked())
  })

  it('locks the switches while a save is in flight and reverts only that change on failure', async () => {
    let rejectFirst!: (e: Error) => void
    mutateAsync.mockReturnValueOnce(new Promise((_, r) => (rejectFirst = r)))
    renderPage()
    const anonymous = screen.getByLabelText('Anonymous posts')
    const signedIn = screen.getByLabelText('Signed-in posts')
    fireEvent.click(anonymous)
    await waitFor(() => expect(anonymous).toBeChecked())
    expect(signedIn).toBeDisabled()
    fireEvent.click(signedIn)
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    await act(async () => rejectFirst(new Error('boom')))
    await waitFor(() => expect(anonymous).not.toBeChecked())
    expect(signedIn).not.toBeChecked()
    expect(signedIn).toBeEnabled()
  })

  it('has no per-switch spinner', () => {
    renderPage()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })
})
