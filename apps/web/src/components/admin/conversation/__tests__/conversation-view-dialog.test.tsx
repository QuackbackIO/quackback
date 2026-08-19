// @vitest-environment happy-dom
/**
 * The saved-view editor dialog, extended (C2.7 / AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 4) with a "Conversation attribute" field group backed by the live
 * attribute registry (conversationAttributeQueries.live()) — same pattern the
 * workflow condition editor's test uses. Covers: the group renders alongside
 * the fixed fields, operators filter per the selected definition's field
 * type, the value control is typed (AttributeValueInput's option picker for
 * select, not a free-text box), value-required vs valueless operators, and an
 * existing view's attribute rule round-trips on open (seeded via ruleToDraft).
 *
 * Radix Select/Dialog need pointer-capture/layout APIs happy-dom doesn't
 * implement, so both are swapped for plain elements here — the same
 * workaround condition-editor.test.tsx uses for Select.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConversationViewDialog } from '../conversation-view-dialog'
import type { ConversationViewDTO } from '@/lib/shared/conversation/views'

const ATTRIBUTES = [
  {
    id: 'attr_issue_type',
    key: 'issue_type',
    label: 'Issue type',
    description: null,
    fieldType: 'select',
    options: [
      { id: 'opt_billing', label: 'Billing', description: null },
      { id: 'opt_bug', label: 'Bug', description: null },
    ],
    requiredToClose: false,
    sourceHint: null,
    aiDetect: false,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'attr_notes',
    key: 'notes',
    label: 'Notes',
    description: null,
    fieldType: 'text',
    options: null,
    requiredToClose: false,
    sourceHint: null,
    aiDetect: false,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
]

const hoisted = vi.hoisted(() => ({
  createConversationViewFn: vi.fn(async () => ({ id: 'view_new' })),
  updateConversationViewFn: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server/functions/conversation-views', () => ({
  createConversationViewFn: hoisted.createConversationViewFn,
  updateConversationViewFn: hoisted.updateConversationViewFn,
}))

vi.mock('@/components/admin/conversation/inbox-nav-sidebar', () => ({
  useConversationTagsWithCounts: () => ({ data: [] }),
  useInboxTeams: () => ({ data: [] }),
  useSupportTicketsEnabled: () => false,
}))

vi.mock('@/lib/client/queries/conversation-attributes', () => ({
  conversationAttributeQueries: {
    live: () => ({ queryKey: ['test', 'attributes'], queryFn: async () => ATTRIBUTES }),
  },
}))

// Native <select>/<option> stand-in, same as condition-editor.test.tsx.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => (
    <option disabled>{children}</option>
  ),
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

// Plain passthrough for Radix Dialog (portal/focus-trap needs happy-dom
// doesn't implement) — renders children only while open, same contract.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

afterEach(cleanup)

function renderDialog(editing?: ConversationViewDTO | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationViewDialog open onOpenChange={() => {}} editing={editing} />
    </QueryClientProvider>
  )
}

/** The rule row's <select>s in DOM order: [field, operator?, value?]. */
function ruleSelects(): HTMLSelectElement[] {
  // The dialog also renders a trailing "Sort" select after the rule rows —
  // drop it so counts here reflect only the (single) rule row under test.
  const all = [...document.querySelectorAll('select')] as HTMLSelectElement[]
  return all.slice(0, -1)
}

describe('ConversationViewDialog — conversation attribute rules', () => {
  it('groups live attribute definitions under "Conversation attribute" in the field picker', async () => {
    renderDialog()
    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    expect(within(fieldSelect).getByText('Conversation attribute')).toBeInTheDocument()
    expect(within(fieldSelect).getByText('Notes')).toBeInTheDocument()
    // Static fields are unaffected — still listed alongside the new group.
    expect(within(fieldSelect).getByText('Status')).toBeInTheDocument()
  })

  it("filters operators to the selected attribute definition's field type", async () => {
    renderDialog()
    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    fireEvent.change(fieldSelect, { target: { value: 'attr:issue_type' } })

    const operatorSelect = ruleSelects()[1]
    const opLabels = within(operatorSelect)
      .getAllByRole('option')
      .map((o) => o.textContent)
    // select field type: eq/neq/is_set/is_empty only — no "contains".
    expect(opLabels).toEqual(['is', 'is not', 'is set', 'is empty'])
  })

  it('renders a typed option picker (not a free-text box) for a select attribute', async () => {
    renderDialog()
    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    fireEvent.change(fieldSelect, { target: { value: 'attr:issue_type' } })

    const selects = ruleSelects()
    expect(selects).toHaveLength(3) // field, operator, value — all still selects here
    const valueSelect = selects[2]
    expect(within(valueSelect).getByText('Billing')).toBeInTheDocument()
    expect(within(valueSelect).getByText('Bug')).toBeInTheDocument()
  })

  it('hides the value control for is_set/is_empty', async () => {
    renderDialog()
    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    fireEvent.change(fieldSelect, { target: { value: 'attr:issue_type' } })

    const operatorSelect = ruleSelects()[1]
    fireEvent.change(operatorSelect, { target: { value: 'is_set' } })

    // Only field + operator selects remain — no third (value) control.
    expect(ruleSelects()).toHaveLength(2)
  })

  it('offers text operators (contains) for a text attribute', async () => {
    renderDialog()
    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    fireEvent.change(fieldSelect, { target: { value: 'attr:notes' } })

    const operatorSelect = ruleSelects()[1]
    const opLabels = within(operatorSelect)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(opLabels).toEqual(['contains', "doesn't contain", 'is', 'is not', 'is set', 'is empty'])
  })

  it('seeds an existing attribute rule on open (key/operator/value round-trip)', async () => {
    const editing: ConversationViewDTO = {
      id: 'view_1' as ConversationViewDTO['id'],
      name: 'Billing issues',
      filters: {
        rules: [{ field: 'attribute', key: 'issue_type', operator: 'eq', value: 'opt_billing' }],
      },
      sort: null,
      isShared: true,
      isPinned: false,
    }
    renderDialog(editing)

    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Issue type')
    expect(fieldSelect.value).toBe('attr:issue_type')
    const operatorSelect = ruleSelects()[1]
    expect(operatorSelect.value).toBe('eq')
    const valueSelect = ruleSelects()[2]
    expect(valueSelect.value).toBe('opt_billing')
  })

  it('degrades an unresolved attribute key (archived/unknown) to a raw value input, not blocking', async () => {
    const editing: ConversationViewDTO = {
      id: 'view_2' as ConversationViewDTO['id'],
      name: 'Stale rule',
      filters: {
        rules: [{ field: 'attribute', key: 'retired_key', operator: 'eq', value: 'anything' }],
      },
      sort: null,
      isShared: true,
      isPinned: false,
    }
    renderDialog(editing)

    const fieldSelect = ruleSelects()[0]
    await within(fieldSelect).findByText('Conversation attribute')
    expect(within(fieldSelect).getByText('retired_key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
  })
})
