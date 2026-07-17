// @vitest-environment happy-dom
/**
 * The condition rule editor, extended (AI attributes parity Phase 0) with a
 * "Conversation attribute" field group backed by the live attribute registry.
 * Covers: the group renders from WorkflowEntitiesProvider data, operators
 * filter per the selected definition's field type, the value input is typed
 * (reusing AttributeValueInput), and an unresolved attribute key degrades to
 * a raw text input instead of blocking.
 *
 * Radix Select needs pointer-capture/layout APIs happy-dom doesn't implement,
 * so `@/components/ui/select` is swapped for a native <select>/<option> pair
 * here — the same pattern monday-config.test.tsx uses.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowEntitiesProvider } from '../../entities'
import { ConditionEditor } from '../condition-editor'
import type { GraphCondition } from '../../../workflow-graph'

const ATTRIBUTES = [
  {
    id: 'attr_plan',
    key: 'plan',
    label: 'Plan',
    description: null,
    fieldType: 'select',
    options: [
      { id: 'opt_free', label: 'Free', description: null },
      { id: 'opt_pro', label: 'Pro', description: null },
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
    id: 'attr_summary',
    key: 'summary',
    label: 'Summary',
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

vi.mock('@/lib/client/hooks/use-team-members', () => ({
  useTeamMembers: () => ({ data: [] }),
}))
vi.mock('@/components/admin/conversation/inbox-nav-sidebar', () => ({
  useInboxTeams: () => ({
    data: [
      { id: 'team_support', name: 'Support' },
      { id: 'team_billing', name: 'Billing' },
    ],
  }),
}))
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/server/functions/sla', () => ({
  listSlaPolicyOptionsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/client/queries/conversation-attributes', () => ({
  conversationAttributeQueries: {
    live: () => ({ queryKey: ['test', 'attributes'], queryFn: async () => ATTRIBUTES }),
  },
}))

// Native <select>/<option> stand-in: Radix's Select relies on pointer-capture
// and scroll APIs happy-dom doesn't implement (see monday-config.test.tsx for
// the same workaround).
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

afterEach(cleanup)

// ConditionEditor is controlled (its rule list derives from the `condition`
// prop, not local state) — a stateful harness feeds each onChange back in, so
// "Add rule" / field / operator changes actually show up on re-render, same as
// the real inspector-panel/branch-editor callers.
function StatefulEditor({ initial }: { initial: GraphCondition }) {
  const [condition, setCondition] = useState(initial)
  return <ConditionEditor subject="Continue when" condition={condition} onChange={setCondition} />
}

function renderEditor(condition: GraphCondition = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>
        <StatefulEditor initial={condition} />
      </WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
}

/** The first (field) <select> in the rendered rule row. */
function fieldSelect(): HTMLSelectElement {
  return document.querySelectorAll('select')[0] as HTMLSelectElement
}
/** The second (operator) <select> in the rendered rule row. */
function operatorSelect(): HTMLSelectElement {
  return document.querySelectorAll('select')[1] as HTMLSelectElement
}

describe('ConditionEditor — conversation attribute fields', () => {
  it('groups live attribute definitions under "Conversation attribute" in the field picker', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('Add rule'))

    const select = fieldSelect()
    // The registry loads async (useQuery) — wait for it before asserting.
    await within(select).findByText('Plan')
    expect(within(select).getByText('Conversation attribute')).toBeInTheDocument()
    expect(within(select).getByText('Summary')).toBeInTheDocument()
    // Static fields are unaffected — still listed alongside the new group.
    expect(within(select).getByText('Conversation status')).toBeInTheDocument()
  })

  it("filters operators to the selected attribute definition's field type", async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('Add rule'))
    await within(fieldSelect()).findByText('Plan')
    fireEvent.change(fieldSelect(), { target: { value: 'conversation.attr.plan' } })

    const opLabels = within(operatorSelect())
      .getAllByRole('option')
      .map((o) => o.textContent)
    // select field type: eq/neq/is_set/is_empty only — no "contains".
    expect(opLabels).toEqual(['is', 'is not', 'is set', 'is empty'])
  })

  it('renders a typed option picker (not a free-text box) for a select attribute', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('Add rule'))
    await within(fieldSelect()).findByText('Plan')
    fireEvent.change(fieldSelect(), { target: { value: 'conversation.attr.plan' } })

    // Three selects now: field, operator, value (an option picker via AttributeValueInput).
    const selects = document.querySelectorAll('select')
    expect(selects).toHaveLength(3)
    const valueSelect = selects[2] as HTMLSelectElement
    expect(within(valueSelect).getByText('Free')).toBeInTheDocument()
    expect(within(valueSelect).getByText('Pro')).toBeInTheDocument()
  })

  it('degrades an unresolved attribute key to a labeled row with a raw value input', async () => {
    renderEditor({ field: 'conversation.attr.retired_key', op: 'eq', value: 'anything' })

    expect(screen.getByText('Unknown attribute retired_key')).toBeInTheDocument()
    // No matching definition: value stays a plain text input, not a picker.
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
  })

  it('hides the value input entirely for is_set/is_empty on an attribute field', async () => {
    renderEditor({ field: 'conversation.attr.plan', op: 'is_set' })
    // Only field + operator selects — no third (value) control.
    expect(document.querySelectorAll('select, input')).toHaveLength(2)
  })
})

describe('ConditionEditor — conversation.team field', () => {
  it('lists Team in the static field picker', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('Add rule'))
    expect(within(fieldSelect()).getByText('Team')).toBeInTheDocument()
  })

  it('offers eq/neq/is_set/is_empty and a live team picker for the value', async () => {
    renderEditor({ field: 'conversation.team', op: 'eq', value: 'team_support' })

    const opLabels = within(operatorSelect())
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(opLabels).toEqual(['is', 'is not', 'is set', 'is empty'])

    const selects = document.querySelectorAll('select')
    expect(selects).toHaveLength(3)
    const valueSelect = selects[2] as HTMLSelectElement
    expect(within(valueSelect).getByText('Support')).toBeInTheDocument()
    expect(within(valueSelect).getByText('Billing')).toBeInTheDocument()
    expect(valueSelect.value).toBe('team_support')
  })

  it('hides the value input for is_empty ("no team assigned")', async () => {
    renderEditor({ field: 'conversation.team', op: 'is_empty' })
    expect(document.querySelectorAll('select, input')).toHaveLength(2)
  })
})
