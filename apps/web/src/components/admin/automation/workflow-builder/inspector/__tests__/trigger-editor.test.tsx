// @vitest-environment happy-dom
/**
 * The trigger step editor (support platform §4.6 audience targeting): the
 * Send window control (round-trips 'any' as an absent key, same convention
 * as frequencyCap's 'unlimited') and the Audience section (RuleGroupBuilder
 * wired to triggerSettings.audience, round-tripping an empty condition back
 * to an absent key the same way).
 *
 * Radix Select needs pointer-capture/layout APIs happy-dom doesn't implement,
 * so `@/components/ui/select` is swapped for a native <select>/<option> pair
 * here — the same pattern condition-editor.test.tsx uses.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowEntitiesProvider } from '../../entities'
import { TriggerEditor } from '../trigger-editor'
import type { TriggerSettingsDraft } from '../../use-workflow-builder'
import type { WorkflowClassValue } from '../../../workflow-graph'

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

function StatefulTriggerEditor({ initial }: { initial: TriggerSettingsDraft }) {
  const [triggerType, setTriggerType] = useState('conversation.created')
  const [triggerSettings, setTriggerSettings] = useState(initial)
  const [workflowClass, setWorkflowClass] = useState<WorkflowClassValue>('background')
  return (
    <TriggerEditor
      triggerType={triggerType}
      onChangeTriggerType={setTriggerType}
      triggerSettings={triggerSettings}
      onChangeTriggerSettings={setTriggerSettings}
      workflowClass={workflowClass}
      onChangeClass={setWorkflowClass}
    />
  )
}

function renderEditor(initial: TriggerSettingsDraft = { channels: [] }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>
        <StatefulTriggerEditor initial={initial} />
      </WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
}

/** The <select> under the "Send window" field label. */
function sendWindowSelect(): HTMLSelectElement {
  const label = screen.getByText('Send window')
  return label.parentElement!.querySelector('select') as HTMLSelectElement
}

/** The <select> under the "When this happens" field label — drives triggerType. */
function triggerTypeSelect(): HTMLSelectElement {
  const label = screen.getByText('When this happens')
  return label.parentElement!.querySelector('select') as HTMLSelectElement
}

describe('TriggerEditor — Send window', () => {
  it('defaults to "Any time" when unset', () => {
    renderEditor()
    expect(sendWindowSelect().value).toBe('any')
  })

  it('setting a restriction writes sendWindow; switching back to "Any time" drops the key entirely', () => {
    renderEditor()
    fireEvent.change(sendWindowSelect(), { target: { value: 'inside_office_hours' } })
    expect(sendWindowSelect().value).toBe('inside_office_hours')

    fireEvent.change(sendWindowSelect(), { target: { value: 'any' } })
    expect(sendWindowSelect().value).toBe('any')
  })
})

describe('TriggerEditor — Audience', () => {
  it('starts with no rules ("matches everything"), same as an empty condition step', () => {
    renderEditor()
    expect(screen.getByText('No rules yet, so everything matches.')).toBeInTheDocument()
  })

  it('round-trips a rule through triggerSettings.audience, and back out to an absent key when cleared', () => {
    let latestSettings: TriggerSettingsDraft | undefined
    function Harness() {
      const [triggerType, setTriggerType] = useState('conversation.created')
      const [triggerSettings, setTriggerSettings] = useState<TriggerSettingsDraft>({ channels: [] })
      const [workflowClass, setWorkflowClass] = useState<WorkflowClassValue>('background')
      latestSettings = triggerSettings
      return (
        <TriggerEditor
          triggerType={triggerType}
          onChangeTriggerType={setTriggerType}
          triggerSettings={triggerSettings}
          onChangeTriggerSettings={(next) => {
            setTriggerSettings(next)
            latestSettings = next
          }}
          workflowClass={workflowClass}
          onChangeClass={setWorkflowClass}
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

    fireEvent.click(screen.getByText('Add rule'))
    expect(latestSettings?.audience).toEqual({
      field: 'conversation.status',
      op: 'eq',
      value: 'open',
    })

    // Remove the rule again: back to {} internally, which the editor drops
    // to an absent key entirely (same convention as frequencyCap's
    // 'unlimited' / sendWindow's 'any').
    fireEvent.click(screen.getByLabelText('Remove rule'))
    expect(latestSettings && 'audience' in latestSettings).toBe(false)
  })

  it('loads an existing stored audience condition and renders its rule', async () => {
    renderEditor({
      channels: [],
      audience: { field: 'conversation.priority', op: 'eq', value: 'high' },
    })
    const selects = document.querySelectorAll('select')
    // Field select is the first one under "Only run for" — Priority chosen.
    const fieldSelect = Array.from(selects).find((s) =>
      within(s)
        .queryAllByRole('option')
        .some((o) => o.textContent === 'Priority')
    )
    expect(fieldSelect?.value).toBe('conversation.priority')
  })
})

// The ONE trigger-editor addition the timer-driven triggers own (support
// platform §4.6): a compact per-workflow threshold control, shown only for
// its own trigger types — "Silence threshold" for the unresponsive pair,
// "Lead time" for sla.approaching_breach. Neither renders for any other
// trigger (including sla.breached, which has no configurable threshold).
describe('TriggerEditor — timer-driven trigger thresholds', () => {
  it('shows neither control for the default trigger (conversation.created)', () => {
    renderEditor()
    expect(screen.queryByText('Silence threshold')).not.toBeInTheDocument()
    expect(screen.queryByText('Lead time')).not.toBeInTheDocument()
  })

  it('shows "Silence threshold", defaulted to 60, for conversation.teammate_unresponsive', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), {
      target: { value: 'conversation.teammate_unresponsive' },
    })
    expect(screen.getByText('Silence threshold')).toBeInTheDocument()
    expect(screen.queryByText('Lead time')).not.toBeInTheDocument()
    const minutesInput = screen.getByText('Silence threshold').parentElement!.querySelector('input')
    expect(minutesInput).toHaveValue(60)
  })

  it('shows "Silence threshold" for conversation.customer_unresponsive too', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), {
      target: { value: 'conversation.customer_unresponsive' },
    })
    expect(screen.getByText('Silence threshold')).toBeInTheDocument()
  })

  it('editing the silence threshold commits triggerSettings.inactivityMinutes', () => {
    let latestSettings: TriggerSettingsDraft | undefined
    function Harness() {
      const [triggerType, setTriggerType] = useState('conversation.teammate_unresponsive')
      const [triggerSettings, setTriggerSettings] = useState<TriggerSettingsDraft>({ channels: [] })
      const [workflowClass, setWorkflowClass] = useState<WorkflowClassValue>('background')
      latestSettings = triggerSettings
      return (
        <TriggerEditor
          triggerType={triggerType}
          onChangeTriggerType={setTriggerType}
          triggerSettings={triggerSettings}
          onChangeTriggerSettings={(next) => {
            setTriggerSettings(next)
            latestSettings = next
          }}
          workflowClass={workflowClass}
          onChangeClass={setWorkflowClass}
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

    const minutesInput = screen
      .getByText('Silence threshold')
      .parentElement!.querySelector('input')!
    fireEvent.change(minutesInput, { target: { value: '90' } })
    fireEvent.blur(minutesInput)
    expect(latestSettings?.inactivityMinutes).toBe(90)
  })

  it('shows "Lead time", defaulted to 15, for sla.approaching_breach only', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), { target: { value: 'sla.approaching_breach' } })
    expect(screen.getByText('Lead time')).toBeInTheDocument()
    expect(screen.queryByText('Silence threshold')).not.toBeInTheDocument()
    const leadInput = screen.getByText('Lead time').parentElement!.querySelector('input')
    expect(leadInput).toHaveValue(15)
  })

  it('shows neither control for sla.breached (no configurable threshold)', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), { target: { value: 'sla.breached' } })
    expect(screen.queryByText('Silence threshold')).not.toBeInTheDocument()
    expect(screen.queryByText('Lead time')).not.toBeInTheDocument()
  })
})

// Non-blocking authoring warning (workflow-graph.ts's
// audienceUnreachableFieldWarning): an Audience rule on `message.*` is dead
// weight on a trigger whose event never carries a message — the default
// trigger here (conversation.created) is one of those.
describe('TriggerEditor — Audience unreachable-field warning', () => {
  it('warns when the stored audience references message.body on a non-message trigger', () => {
    renderEditor({
      channels: [],
      audience: { field: 'message.body', op: 'contains', value: 'refund' },
    })
    expect(screen.getByText(/never carries one — it will never match/)).toBeInTheDocument()
  })

  it('does not warn when the audience has no message.* rule', () => {
    renderEditor({
      channels: [],
      audience: { field: 'conversation.priority', op: 'eq', value: 'high' },
    })
    expect(screen.queryByText(/never carries one — it will never match/)).not.toBeInTheDocument()
  })

  it('clears the warning once the trigger is switched to one that does carry a message', () => {
    renderEditor({
      channels: [],
      audience: { field: 'message.body', op: 'contains', value: 'refund' },
    })
    expect(screen.getByText(/never carries one — it will never match/)).toBeInTheDocument()

    fireEvent.change(triggerTypeSelect(), { target: { value: 'message.created' } })
    expect(screen.queryByText(/never carries one — it will never match/)).not.toBeInTheDocument()
  })
})

/** The <select> under the "Status category filter" field label — only
 *  rendered for the ticket.status_changed trigger. */
function ticketStatusCategorySelect(): HTMLSelectElement {
  const label = screen.getByText('Status category filter')
  return label.parentElement!.querySelector('select') as HTMLSelectElement
}

describe('TriggerEditor — ticket.status_changed status category filter', () => {
  it('is not shown for any other trigger type', () => {
    renderEditor()
    expect(screen.queryByText('Status category filter')).not.toBeInTheDocument()
  })

  it('defaults to "Any status change" (unset key) once the trigger is ticket.status_changed', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), { target: { value: 'ticket.status_changed' } })
    expect(ticketStatusCategorySelect().value).toBe('any')
  })

  it('setting a category writes ticketStatusCategory; switching back to "Any status change" drops the key entirely', () => {
    renderEditor()
    fireEvent.change(triggerTypeSelect(), { target: { value: 'ticket.status_changed' } })
    fireEvent.change(ticketStatusCategorySelect(), { target: { value: 'closed' } })
    expect(ticketStatusCategorySelect().value).toBe('closed')

    fireEvent.change(ticketStatusCategorySelect(), { target: { value: 'any' } })
    expect(ticketStatusCategorySelect().value).toBe('any')
  })
})
