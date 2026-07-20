// @vitest-environment happy-dom
/**
 * Create-ticket dialog — convergence Phase 4: the registry type picker
 * (category default preselected), the type swap exchanging the dynamic field
 * set, inline validation against the chosen type's fields, and the submit
 * payload carrying ticketTypeId + validated customAttributes (never a bare
 * category alongside a registry type). Phase 5 adds the copilot auto-fill:
 * the "✨ Auto-fill" affordance (flag-gated, from-a-conversation only),
 * suggestion markers + undo, the not-suggested state, the quiet unavailable
 * fallback, and submits carrying edited suggestions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import type { TicketTypeDTO } from '@/lib/shared/tickets'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  listTicketTypesFn: vi.fn(),
  linkTicketToConversationFn: vi.fn(),
  suggestTicketFieldValuesFn: vi.fn(),
  toastInfo: vi.fn(),
  routeContext: {
    settings: { featureFlags: { inboxAi: true } },
  } as Record<string, unknown>,
}))

vi.mock('@/lib/client/mutations/inbox', () => ({
  useCreateTicket: () => ({ mutate: mocks.mutate, isPending: false }),
}))
vi.mock('@/lib/server/functions/ticket-types', () => ({
  listTicketTypesFn: mocks.listTicketTypesFn,
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  linkTicketToConversationFn: mocks.linkTicketToConversationFn,
  suggestTicketFieldValuesFn: mocks.suggestTicketFieldValuesFn,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => mocks.routeContext,
}))
vi.mock('sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))
// Heavy/irrelevant children stubbed: the rich editor (tiptap), image upload,
// and the requester picker (covered by its own surface).
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/components/shared/portal-user-picker', () => ({ PortalUserPicker: () => null }))

import { CreateTicketDialog } from '../create-ticket-dialog'

const field = (over: Partial<TicketTypeDTO['fields'][number]>) => ({
  key: 'field',
  label: 'Field',
  type: 'text' as const,
  required: false,
  visibleToCustomer: true,
  order: 0,
  ...over,
})

const bugType: TicketTypeDTO = {
  id: 'ticket_type_bug',
  name: 'Bug report',
  slug: 'bug_report',
  category: 'customer',
  icon: '🐛',
  color: '#eab308',
  fields: [field({ key: 'steps', label: 'Steps to reproduce' })],
  isDefault: true,
  position: 0,
  intakeVisible: true,
  archived: false,
}

const refundType: TicketTypeDTO = {
  id: 'ticket_type_refund',
  name: 'Refund request',
  slug: 'refund_request',
  category: 'customer',
  icon: '💳',
  color: '#22c55e',
  fields: [field({ key: 'order_id', label: 'Order id', required: true })],
  isDefault: false,
  position: 1,
  intakeVisible: true,
  archived: false,
}

const outageType: TicketTypeDTO = {
  id: 'ticket_type_outage',
  name: 'Outage',
  slug: 'outage',
  category: 'tracker',
  icon: '📡',
  color: '#6b7280',
  fields: [],
  isDefault: true,
  position: 0,
  intakeVisible: false,
  archived: false,
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

function renderDialog(props: Partial<Parameters<typeof CreateTicketDialog>[0]> = {}) {
  return render(<CreateTicketDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} {...props} />, {
    wrapper: wrapper(),
  })
}

/** Open a Radix Select and pick one of its options by visible text. happy-dom
 *  doesn't open the popover on pointerDown, but ArrowDown on the focused
 *  trigger works (the repo's DropdownMenu tests use pointerDown instead). */
async function pickSelectOption(trigger: HTMLElement, optionText: string) {
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const option = await screen.findByRole('option', { name: new RegExp(optionText) })
  fireEvent.click(option)
}

beforeEach(() => {
  Element.prototype.scrollIntoView ??= (() => {}) as never
  mocks.mutate.mockReset()
  mocks.linkTicketToConversationFn.mockReset()
  mocks.suggestTicketFieldValuesFn.mockReset()
  mocks.toastInfo.mockReset()
  mocks.routeContext = { settings: { featureFlags: { inboxAi: true } } }
  mocks.listTicketTypesFn.mockReset()
  mocks.listTicketTypesFn.mockResolvedValue([bugType, refundType, outageType])
})

afterEach(cleanup)

describe('CreateTicketDialog — Phase 4 type picker', () => {
  it('preselects the customer-category default type and renders its fields', async () => {
    renderDialog()
    // The default type leads: its name in the trigger, its field set below.
    expect(await screen.findByText('Bug report')).toBeInTheDocument()
    expect(await screen.findByText('Steps to reproduce')).toBeInTheDocument()
    expect(screen.queryByText('Order id')).toBeNull()
  })

  it('swapping types swaps the dynamic field set', async () => {
    renderDialog()
    const trigger = await screen.findByRole('combobox')
    expect(await screen.findByText('Steps to reproduce')).toBeInTheDocument()

    await pickSelectOption(trigger, 'Refund request')
    expect(await screen.findByText('Order id')).toBeInTheDocument()
    expect(screen.queryByText('Steps to reproduce')).toBeNull()
  })

  it('blocks submit on a required type field with an inline error', async () => {
    renderDialog()
    await pickSelectOption(await screen.findByRole('combobox'), 'Refund request')
    fireEvent.change(await screen.findByPlaceholderText('Summarize the request…'), {
      target: { value: 'Refund missing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(await screen.findByText('Order id is required')).toBeInTheDocument()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('submits with ticketTypeId + validated customAttributes and no bare category', async () => {
    renderDialog()
    await pickSelectOption(await screen.findByRole('combobox'), 'Refund request')
    fireEvent.change(await screen.findByPlaceholderText('Summarize the request…'), {
      target: { value: 'Refund missing' },
    })
    // The type's required text field renders as a plain input under its label.
    const orderInput = (await screen.findByText('Order id')).parentElement!.querySelector('input')!
    fireEvent.change(orderInput, { target: { value: 'A-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1))
    const [input] = mocks.mutate.mock.calls[0]
    expect(input).toMatchObject({
      ticketTypeId: 'ticket_type_refund',
      title: 'Refund missing',
      customAttributes: { order_id: 'A-123' },
    })
    // The category is derived server-side from the type — never sent alongside.
    expect(input.type).toBeUndefined()
  })

  it('limits the picker to customer-category types in the from-a-conversation flow', async () => {
    renderDialog({ conversationId: 'conversation_1' as never })
    const trigger = await screen.findByRole('combobox')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(await screen.findByRole('option', { name: /Bug report/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Outage/ })).toBeNull()
  })
})

/** A two-field customer type for the auto-fill tests: one field the model
 *  answers, one it leaves "not suggested". */
const richType: TicketTypeDTO = {
  id: 'ticket_type_rich',
  name: 'Bug report',
  slug: 'bug_report',
  category: 'customer',
  icon: '🐛',
  color: '#eab308',
  fields: [
    field({ key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'High'] }),
    field({ key: 'steps', label: 'Steps to reproduce', order: 1 }),
  ],
  isDefault: true,
  position: 0,
  intakeVisible: true,
  archived: false,
}

describe('CreateTicketDialog — Phase 5 copilot auto-fill', () => {
  function renderFromConversation() {
    mocks.listTicketTypesFn.mockResolvedValue([richType])
    return renderDialog({ conversationId: 'conversation_1' as never })
  }

  it('shows the affordance from-a-conversation with the inboxAi flag on; hides it standalone or with the flag off', async () => {
    renderFromConversation()
    expect(await screen.findByRole('button', { name: /Auto-fill/ })).toBeInTheDocument()
    cleanup()

    // Standalone (no conversation): exactly the Phase-4 dialog.
    renderDialog()
    await screen.findByText('Bug report')
    expect(screen.queryByRole('button', { name: /Auto-fill/ })).toBeNull()
    cleanup()

    // Flag off: the affordance never renders.
    mocks.routeContext = { settings: { featureFlags: { inboxAi: false } } }
    renderFromConversation()
    await screen.findByText('Bug report')
    expect(screen.queryByRole('button', { name: /Auto-fill/ })).toBeNull()
  })

  it('populates suggested values with ✨ markers and counts them in the header badge', async () => {
    mocks.suggestTicketFieldValuesFn.mockResolvedValue({
      suggestions: { title: 'CSV export drops filter columns', severity: 'High' },
    })
    renderFromConversation()
    fireEvent.click(await screen.findByRole('button', { name: /Auto-fill/ }))

    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Summarize the request…') as HTMLInputElement).value
      ).toBe('CSV export drops filter columns')
    )
    expect(mocks.suggestTicketFieldValuesFn).toHaveBeenCalledWith({
      data: { conversationId: 'conversation_1', ticketTypeId: 'ticket_type_rich' },
    })
    // The suggested select shows its value; both fields carry the ✨ marker
    // (title + severity), and the unanswered field renders "not suggested".
    expect(await screen.findByText('High')).toBeInTheDocument()
    expect(screen.getAllByText('✨ suggested')).toHaveLength(2)
    expect(screen.getByText('✨ 2 suggested')).toBeInTheDocument()
    expect(screen.getByText('— not suggested')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo suggestions' })).toBeInTheDocument()
  })

  it('undo restores the exact pre-suggestion form and drops every marker', async () => {
    mocks.suggestTicketFieldValuesFn.mockResolvedValue({
      suggestions: { title: 'Suggested title', severity: 'High', steps: 'suggested steps' },
    })
    renderFromConversation()
    fireEvent.change(await screen.findByPlaceholderText('Summarize the request…'), {
      target: { value: 'My own title' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Auto-fill/ }))
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Summarize the request…') as HTMLInputElement).value
      ).toBe('Suggested title')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo suggestions' }))
    expect((screen.getByPlaceholderText('Summarize the request…') as HTMLInputElement).value).toBe(
      'My own title'
    )
    expect(screen.queryByText('✨ suggested')).toBeNull()
    expect(screen.queryByText(/✨ \d+ suggested/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo suggestions' })).toBeNull()
  })

  it('unavailable retires the affordance with a quiet note and leaves the form unchanged', async () => {
    mocks.suggestTicketFieldValuesFn.mockResolvedValue({ unavailable: true })
    renderFromConversation()
    fireEvent.change(await screen.findByPlaceholderText('Summarize the request…'), {
      target: { value: 'Keep me' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Auto-fill/ }))

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Auto-fill/ })).toBeNull()
    expect((screen.getByPlaceholderText('Summarize the request…') as HTMLInputElement).value).toBe(
      'Keep me'
    )
    expect(screen.queryByText('✨ suggested')).toBeNull()
  })

  it('a failed call keeps the plain form too (quiet note, button stays for retry)', async () => {
    mocks.suggestTicketFieldValuesFn.mockRejectedValue(new Error('network down'))
    renderFromConversation()
    fireEvent.click(await screen.findByRole('button', { name: /Auto-fill/ }))

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Auto-fill/ })).toBeInTheDocument()
    expect(screen.queryByText('✨ suggested')).toBeNull()
  })

  it('submit carries edited suggestions through the normal create path', async () => {
    mocks.suggestTicketFieldValuesFn.mockResolvedValue({
      suggestions: { title: 'CSV export drops filter columns', severity: 'High', steps: 'repro' },
    })
    renderFromConversation()
    fireEvent.click(await screen.findByRole('button', { name: /Auto-fill/ }))
    await screen.findByText('✨ 3 suggested')

    // The agent edits a suggested value before saving — everything stays editable.
    const stepsInput = (await screen.findByText('Steps to reproduce')).parentElement!.querySelector(
      'input'
    )!
    fireEvent.change(stepsInput, { target: { value: 'edited repro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1))
    const [input] = mocks.mutate.mock.calls[0]
    expect(input).toMatchObject({
      ticketTypeId: 'ticket_type_rich',
      title: 'CSV export drops filter columns',
      customAttributes: { severity: 'High', steps: 'edited repro' },
    })
  })

  it('a type swap clears suggestion state with the old field set', async () => {
    mocks.listTicketTypesFn.mockResolvedValue([richType, refundType])
    mocks.suggestTicketFieldValuesFn.mockResolvedValue({
      suggestions: { title: 'Suggested', severity: 'High' },
    })
    renderDialog({ conversationId: 'conversation_1' as never })
    fireEvent.click(await screen.findByRole('button', { name: /Auto-fill/ }))
    await screen.findByText('✨ 2 suggested')

    // richType's severity select adds a second combobox; the type picker is first.
    await pickSelectOption((await screen.findAllByRole('combobox'))[0], 'Refund request')
    expect(screen.queryByText(/✨ \d+ suggested/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo suggestions' })).toBeNull()
    expect((screen.getByPlaceholderText('Summarize the request…') as HTMLInputElement).value).toBe(
      'Suggested'
    )
  })
})
