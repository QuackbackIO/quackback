// @vitest-environment happy-dom
/**
 * Coverage for the CF1 fix: a stored row can carry a legacy/unknown
 * triggerType (the manager UI's "Other" bucket explicitly anticipates these)
 * or a malformed frequencyCap (any non-UI writer). Before this fix, save()
 * always sent both fields back verbatim, so the server's closed-enum /
 * discriminated-union validation rejected EVERY save on such a row, even a
 * plain rename. Two things are covered: save() only sends triggerType /
 * triggerSettings when they actually differ from the loaded row (the
 * dirty-gate), and a bogus stored frequencyCap is sanitized to "No limit" on
 * load instead of being carried forward uneditable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'
import { useWorkflowBuilder } from '../use-workflow-builder'
import { WorkflowEntitiesProvider } from '../entities'

// useWorkflowBuilder pulls entity labels from WorkflowEntitiesProvider, which
// otherwise fires real queries — keep those trivial, same as canvas.test.tsx.
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

const mutate = vi.fn()
vi.mock('@/lib/client/mutations/workflows', () => ({
  useUpdateWorkflow: () => ({ mutate, isPending: false }),
  useSetWorkflowStatus: () => ({ mutate: vi.fn(), isPending: false }),
}))

afterEach(() => {
  cleanup()
  mutate.mockClear()
})

function fixtureWorkflow(overrides: Partial<WorkflowDTO> = {}): WorkflowDTO {
  return {
    id: 'wf_1',
    name: 'Reassign VIPs',
    class: 'customer_facing',
    status: 'draft',
    sortOrder: 0,
    triggerType: 'conversation.created',
    triggerSettings: { channels: ['email'] },
    graph: { nodes: [], edges: [] },
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function renderBuilder(workflow: WorkflowDTO) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>{children}</WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
  return renderHook(() => useWorkflowBuilder(workflow), { wrapper })
}

describe('save(): dirty-gates triggerType / triggerSettings', () => {
  it('omits both fields when neither was touched (only a rename happened)', () => {
    const workflow = fixtureWorkflow({
      triggerType: 'legacy.retired_event', // not in TRIGGER_TYPES — the "Other" bucket case
      triggerSettings: { channels: ['email'], frequencyCap: { type: 'once' } },
    })
    const { result } = renderBuilder(workflow)

    act(() => result.current.changeName('Reassign VIPs (renamed)'))
    act(() => result.current.save())

    expect(mutate).toHaveBeenCalledTimes(1)
    const payload = mutate.mock.calls[0]![0]
    expect(payload.name).toBe('Reassign VIPs (renamed)')
    expect(payload).not.toHaveProperty('triggerType')
    expect(payload).not.toHaveProperty('triggerSettings')
  })

  it('includes triggerType when it was actually changed', () => {
    const { result } = renderBuilder(fixtureWorkflow())

    act(() => result.current.changeTriggerType('message.created'))
    act(() => result.current.save())

    const payload = mutate.mock.calls[0]![0]
    expect(payload.triggerType).toBe('message.created')
    expect(payload).not.toHaveProperty('triggerSettings')
  })

  it('round-trips the conversation.attribute_changed trigger type through the builder', () => {
    const { result } = renderBuilder(fixtureWorkflow())

    act(() => result.current.changeTriggerType('conversation.attribute_changed'))
    expect(result.current.triggerType).toBe('conversation.attribute_changed')
    act(() => result.current.save())

    const payload = mutate.mock.calls[0]![0]
    expect(payload.triggerType).toBe('conversation.attribute_changed')
  })

  it('includes triggerSettings when its content was actually changed', () => {
    const { result } = renderBuilder(fixtureWorkflow({ triggerSettings: { channels: ['email'] } }))

    act(() =>
      result.current.changeTriggerSettings({ ...result.current.triggerSettings, channels: [] })
    )
    act(() => result.current.save())

    const payload = mutate.mock.calls[0]![0]
    expect(payload).not.toHaveProperty('triggerType')
    expect(payload.triggerSettings).toEqual({ channels: [] })
  })
})

describe('trigger settings draft: sanitizes a bogus stored frequencyCap on load', () => {
  it('a cap outside the discriminated union bounds loads as "No limit"', () => {
    const workflow = fixtureWorkflow({
      triggerSettings: { channels: [], frequencyCap: { type: 'once_per_days', days: 99999 } },
    })
    const { result } = renderBuilder(workflow)

    expect(result.current.triggerSettings.frequencyCap).toBeUndefined()
  })

  it('an unrecognized cap type loads as "No limit" too', () => {
    const workflow = fixtureWorkflow({
      triggerSettings: { channels: [], frequencyCap: { type: 'sometimes' } },
    })
    const { result } = renderBuilder(workflow)

    expect(result.current.triggerSettings.frequencyCap).toBeUndefined()
  })

  it('editing settings on such a row saves a clean, valid shape', () => {
    const workflow = fixtureWorkflow({
      triggerSettings: { channels: [], frequencyCap: { type: 'once_per_days', days: 99999 } },
    })
    const { result } = renderBuilder(workflow)

    act(() =>
      result.current.changeTriggerSettings({
        ...result.current.triggerSettings,
        frequencyCap: { type: 'n_total', count: 5 },
      })
    )
    act(() => result.current.save())

    const payload = mutate.mock.calls[0]![0]
    expect(payload.triggerSettings).toEqual({
      channels: [],
      frequencyCap: { type: 'n_total', count: 5 },
    })
  })
})
