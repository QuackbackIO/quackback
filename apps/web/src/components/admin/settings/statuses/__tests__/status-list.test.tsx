// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

const updateStatusFn = vi.fn()
const createStatusFn = vi.fn()
const deleteStatusFn = vi.fn()
const reorderStatusesFn = vi.fn()
vi.mock('@/lib/server/functions/statuses', () => ({
  updateStatusFn: (a: unknown) => updateStatusFn(a),
  createStatusFn: (a: unknown) => createStatusFn(a),
  deleteStatusFn: (a: unknown) => deleteStatusFn(a),
  reorderStatusesFn: (a: unknown) => reorderStatusesFn(a),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))

const { StatusesSettingsPage } = await import('../status-list')

function status(over: Record<string, unknown>) {
  return {
    id: 'status_x',
    name: 'X',
    slug: 'x',
    color: '#3b82f6',
    category: 'active',
    position: 0,
    showOnRoadmap: false,
    isDefault: false,
    ...over,
  } as never
}

const STATUSES = [
  status({ id: 's_open', name: 'Open', slug: 'open', isDefault: true, position: 0 }),
  status({ id: 's_review', name: 'Under Review', slug: 'under_review', position: 1 }),
  status({ id: 's_planned', name: 'Planned', slug: 'planned', position: 2, showOnRoadmap: true }),
  status({
    id: 's_done',
    name: 'Complete',
    slug: 'complete',
    category: 'complete',
    isDefault: false,
  }),
  status({ id: 's_done2', name: 'Shipped', slug: 'shipped', category: 'complete', position: 1 }),
  status({ id: 's_closed', name: 'Closed', slug: 'closed', category: 'closed' }),
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <StatusesSettingsPage initialStatuses={STATUSES} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  updateStatusFn.mockReset().mockResolvedValue({})
  createStatusFn.mockReset()
  deleteStatusFn.mockReset()
  reorderStatusesFn.mockReset()
  toastError.mockReset()
})
afterEach(cleanup)

describe('StatusesSettingsPage', () => {
  it('is the Statuses page with no breadcrumb of its own and a New status button in the header', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Statuses' })).toBeInTheDocument()
    // The settings layout titles it with its module and shows the module's tabs.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New status' })).toBeInTheDocument()
    expect(screen.queryByText('Add new status')).toBeNull()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('gives each category card a one-clause description and a Roadmap column header', () => {
    renderPage()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Done, shown as completed')).toBeInTheDocument()
    expect(screen.getByText("Won't be done")).toBeInTheDocument()
    expect(screen.getAllByText('Roadmap')).toHaveLength(3)
  })

  it('locks every status that cannot be deleted and no other', () => {
    renderPage()
    // Open is the default; Closed is the only status in its category. Complete
    // has a sibling, so it can be deleted and stays unlocked.
    const lockedRows = screen
      .getAllByLabelText('Locked')
      .map((lock) => lock.closest('[data-slot="settings-list-row"]')?.textContent)
    expect(lockedRows).toHaveLength(2)
    expect(lockedRows[0]).toContain('Open')
    expect(lockedRows[1]).toContain('Closed')
  })

  it('shows a lock and no Delete item for the default status', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getAllByLabelText('Locked').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Actions for Open' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('offers Delete on other statuses and confirms with Delete status', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Actions for Under Review' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText('Delete status?')).toBeInTheDocument()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Delete status' })).toBeInTheDocument()
  })

  it('saves a roadmap toggle immediately', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: 'Show Under Review on the roadmap' }))
    await waitFor(() =>
      expect(updateStatusFn).toHaveBeenCalledWith({
        data: { id: 's_review', showOnRoadmap: true },
      })
    )
  })

  it('reverts the switch when the save fails and leaves the toast to the autosave handler', async () => {
    let reject!: (e: Error) => void
    updateStatusFn.mockReturnValue(new Promise((_, r) => (reject = r)))
    renderPage()
    const sw = screen.getByRole('switch', { name: 'Show Under Review on the roadmap' })
    expect(sw).not.toBeChecked()
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toBeChecked())
    await act(async () => reject(new Error('boom')))
    await waitFor(() => expect(sw).not.toBeChecked())
    expect(toastError).not.toHaveBeenCalled()
  })

  it('asks for the category when creating a status', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New status' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Category')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create status' })).toBeInTheDocument()
  })
})
