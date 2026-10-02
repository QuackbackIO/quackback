// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { Suspense } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const TYPES = [
  {
    id: 'ticket_type_1',
    name: 'Question',
    slug: 'question',
    category: 'customer',
    icon: null,
    color: '#3b82f6',
    fields: [],
    isDefault: true,
    position: 0,
    intakeVisible: true,
    archived: false,
    ticketCount: 4,
  },
  {
    id: 'ticket_type_2',
    name: 'Bug triage',
    slug: 'bug_triage',
    category: 'back_office',
    icon: null,
    color: '#ef4444',
    fields: [],
    isDefault: true,
    position: 0,
    intakeVisible: false,
    archived: false,
    ticketCount: 0,
  },
]

vi.mock('@/lib/server/functions/ticket-types', () => ({
  listTicketTypesFn: vi.fn(async () => TYPES),
  createTicketTypeFn: vi.fn(),
  updateTicketTypeFn: vi.fn(),
  archiveTicketTypeFn: vi.fn(),
  restoreTicketTypeFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  listTicketStatusesFn: vi.fn(),
  getTicketStageLabelsFn: vi.fn(),
}))

import { TicketTypesManager } from '../ticket-types-manager'

function renderManager(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>
  )
}

afterEach(cleanup)

describe('TicketTypesManager', () => {
  it('groups types under their category and does not repeat the category or Default on rows', async () => {
    renderManager(<TicketTypesManager creating={false} onCreatingChange={() => {}} />)
    const question = await screen.findByText('Question')
    const row = question.closest('[data-slot="settings-list-row"]') as HTMLElement
    expect(within(row).queryByText('Customer')).toBeNull()
    expect(within(row).queryByText('Default')).toBeNull()
    // The category appears once, as the group header.
    expect(screen.getAllByText('Back office')).toHaveLength(1)
    const bugRow = screen.getByText('Bug triage').closest('[data-slot="settings-list-row"]')!
    expect(within(bugRow as HTMLElement).getByText('Internal')).toBeTruthy()
  })

  it('offers Edit and Archive from the row menu', async () => {
    const user = userEvent.setup()
    renderManager(<TicketTypesManager creating={false} onCreatingChange={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Question' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy()
  })

  it('opens the create dialog when the page asks for a new type', async () => {
    renderManager(<TicketTypesManager creating onCreatingChange={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'New type' })).toBeTruthy()
  })
})
