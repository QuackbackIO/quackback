// @vitest-environment happy-dom
/**
 * RuleGroupBuilder (support platform §4.6, shared rule-group builder): the
 * flat single-group case (unchanged from the old ConditionEditor), the new
 * OR-of-groups case (add/remove a group, an "OR" divider between groups,
 * round-trip to the exact `any: [ {all:[...]}, ... ]` stored shape), and the
 * read-only degrade for a condition too deep to render.
 *
 * Radix Select needs pointer-capture/layout APIs happy-dom doesn't implement,
 * so `@/components/ui/select` is swapped for a native <select>/<option> pair
 * here — the same pattern condition-editor.test.tsx uses.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowEntitiesProvider } from '../../entities'
import { RuleGroupBuilder } from '../rule-group-builder'
import type { GraphCondition } from '../../../workflow-graph'

vi.mock('@/lib/client/hooks/use-team-members', () => ({
  useTeamMembers: () => ({ data: [] }),
}))
vi.mock('@/components/admin/conversation/inbox-nav-sidebar', () => ({
  useInboxTeams: () => ({ data: [] }),
}))
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/server/functions/sla', () => ({
  listSlaPolicyOptionsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/client/queries/conversation-attributes', () => ({
  conversationAttributeQueries: {
    live: () => ({ queryKey: ['test', 'attributes'], queryFn: async () => [] }),
  },
}))
vi.mock('@/lib/client/hooks/use-user-attributes-queries', () => ({
  useUserAttributes: () => ({ data: [] }),
}))
vi.mock('@/lib/client/hooks/use-company-attributes-queries', () => ({
  useCompanyAttributes: () => ({ data: [] }),
}))

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

// RuleGroupBuilder is controlled — a stateful harness feeds each onChange
// back in, same as condition-editor.test.tsx's StatefulEditor.
function StatefulBuilder({
  initial,
  advancedFallback,
}: {
  initial: GraphCondition
  advancedFallback?: string
}) {
  const [condition, setCondition] = useState(initial)
  return (
    <RuleGroupBuilder
      subject="Runs when"
      condition={condition}
      onChange={setCondition}
      advancedFallback={advancedFallback}
    />
  )
}

function renderBuilder(condition: GraphCondition = {}, advancedFallback?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>
        <StatefulBuilder initial={condition} advancedFallback={advancedFallback} />
      </WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
}

describe('RuleGroupBuilder — single group (flat, unchanged UX)', () => {
  it('starts empty with "matches everything" and no group chrome', () => {
    renderBuilder()
    expect(screen.getByText('No rules yet, so everything matches.')).toBeInTheDocument()
    expect(screen.queryByText('OR')).not.toBeInTheDocument()
    expect(screen.getByText('Add rule')).toBeInTheDocument()
    expect(screen.getByText('Add group (OR)')).toBeInTheDocument()
  })

  it('adds and removes a rule within the single implicit group', () => {
    renderBuilder()
    fireEvent.click(screen.getByText('Add rule'))
    expect(screen.queryByText('No rules yet, so everything matches.')).not.toBeInTheDocument()
    // defaultRule() is conversation.status eq "open" — a choice field, so the
    // value is a third (typed) select: field + operator + value.
    expect(document.querySelectorAll('select')).toHaveLength(3)

    fireEvent.click(screen.getByLabelText('Remove rule'))
    expect(screen.getByText('No rules yet, so everything matches.')).toBeInTheDocument()
  })

  it('has no remove-group button when there is only one group', () => {
    renderBuilder({ field: 'conversation.status', op: 'eq', value: 'open' })
    expect(screen.queryByLabelText('Remove group')).not.toBeInTheDocument()
  })
})

describe('RuleGroupBuilder — OR of groups', () => {
  it('"Add group" creates a second group with an OR divider between them', () => {
    renderBuilder({ field: 'conversation.status', op: 'eq', value: 'open' })
    expect(screen.queryByText('OR')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Add group (OR)'))
    expect(screen.getByText('OR')).toBeInTheDocument()
    // Two "Add rule" buttons, one per group, plus one "Add group".
    expect(screen.getAllByText('Add rule')).toHaveLength(2)
    // Both groups are now removable.
    expect(screen.getAllByLabelText('Remove group')).toHaveLength(2)
  })

  it('removing a group falls back to a single group with no OR chrome', () => {
    const nested: GraphCondition = {
      any: [
        { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
        { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
      ],
    }
    renderBuilder(nested)
    expect(screen.getByText('OR')).toBeInTheDocument()
    fireEvent.click(screen.getAllByLabelText('Remove group')[0]!)
    expect(screen.queryByText('OR')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Remove group')).not.toBeInTheDocument()
  })

  it('round-trips a 2-group OR condition to the exact `any: [{all:[...]},{all:[...]}]` shape', () => {
    let latest: GraphCondition | undefined
    function Harness() {
      const [condition, setCondition] = useState<GraphCondition>({
        field: 'conversation.status',
        op: 'eq',
        value: 'open',
      })
      latest = condition
      return (
        <RuleGroupBuilder
          subject="Runs when"
          condition={condition}
          onChange={(c) => {
            setCondition(c)
            latest = c
          }}
        />
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowEntitiesProvider>
          <Harness />
        </WorkflowEntitiesProvider>
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByText('Add group (OR)'))
    expect(latest).toEqual({
      any: [
        { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
        { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
      ],
    })
  })

  it('renders every group nested, each with its own rule rows', async () => {
    const nested: GraphCondition = {
      any: [
        {
          all: [
            { field: 'conversation.priority', op: 'eq', value: 'high' },
            { field: 'conversation.status', op: 'eq', value: 'open' },
          ],
        },
        { any: [{ field: 'office_hours', op: 'eq', value: true }] },
      ],
    }
    renderBuilder(nested)
    expect(screen.getByText('OR')).toBeInTheDocument()
    // First group has 2 rules (mode selector shown), second has 1.
    expect(screen.getByText('of these match')).toBeInTheDocument()
    // group1: 1 mode select + 2 rules * 3 selects (field/op/value, both
    // choice-kind fields) = 7; group2: 1 rule * 3 selects (a boolean value is
    // also a select) = 3. Total 10.
    expect(document.querySelectorAll('select')).toHaveLength(10)
  })

  it('renders the "ignored" copy (not "everything matches") for an already-emptied group in a legacy multi-group OR, and the next edit drops it from the saved condition', () => {
    // Regression for the vacuously-true {all: []} bug: a condition saved (or
    // JSON-mode-authored) with an emptied group inside a multi-group OR still
    // decodes and renders — but must read as "ignored", not "matches
    // everything" (that copy is reserved for the single-group case), and the
    // very next edit must re-encode WITHOUT it (see groupsToCondition).
    const legacyEmptyGroup: GraphCondition = {
      any: [{ all: [] }, { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    }
    let latest: GraphCondition | undefined
    function Harness() {
      const [condition, setCondition] = useState<GraphCondition>(legacyEmptyGroup)
      latest = condition
      return (
        <RuleGroupBuilder
          subject="Runs when"
          condition={condition}
          onChange={(c) => {
            setCondition(c)
            latest = c
          }}
        />
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowEntitiesProvider>
          <Harness />
        </WorkflowEntitiesProvider>
      </QueryClientProvider>
    )

    expect(screen.getByText('OR')).toBeInTheDocument()
    expect(
      screen.getByText("No rules in this group — it's ignored until you add one.")
    ).toBeInTheDocument()
    expect(screen.queryByText('No rules yet, so everything matches.')).not.toBeInTheDocument()

    // Editing the OTHER (real) group's rule count still re-encodes the whole
    // draft — dropping the emptied group instead of reproducing {all: []}.
    fireEvent.click(screen.getAllByText('Add rule')[1]!)
    expect(latest).toEqual({
      all: [
        { field: 'conversation.status', op: 'eq', value: 'open' },
        { field: 'conversation.status', op: 'eq', value: 'open' },
      ],
    })
  })
})

describe('RuleGroupBuilder — depth-capped fallback', () => {
  it('degrades a group nesting a group (3 levels) to a read-only notice instead of rendering', () => {
    const tripleNested: GraphCondition = {
      any: [{ all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }] }],
    }
    renderBuilder(tripleNested)
    expect(
      screen.getByText(
        "This condition nests groups the visual editor can't show. Use JSON mode to change it."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Add rule')).not.toBeInTheDocument()
    expect(screen.queryByText('Add group (OR)')).not.toBeInTheDocument()
  })

  it('degrades a top-level AND of groups (only OR-of-groups is representable)', () => {
    const andOfGroups: GraphCondition = {
      all: [
        { any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
        { any: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
      ],
    }
    renderBuilder(andOfGroups)
    expect(screen.getByText(/nests groups the visual editor can't show/)).toBeInTheDocument()
  })

  it('accepts a caller-supplied fallback message (e.g. the trigger Audience section, which has no JSON mode)', () => {
    const tripleNested: GraphCondition = {
      any: [{ all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }] }],
    }
    renderBuilder(tripleNested, 'This audience is too deeply nested to edit here.')
    expect(screen.getByText('This audience is too deeply nested to edit here.')).toBeInTheDocument()
  })
})
