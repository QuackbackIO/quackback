// @vitest-environment happy-dom
/**
 * Priority reordering in the workflows manager (support platform §4.6). Within
 * one trigger group the live customer-facing workflows compete for a single
 * exclusive first-match slot, so their stored order is the rule that decides
 * which one runs. Covers the ranking shown on the rows, the drag affordance,
 * and the reorder the drop persists.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, renderHook, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

const hoisted = vi.hoisted(() => ({
  listWorkflowsFn: vi.fn(),
  reorderWorkflowsFn: vi.fn(),
  workflowEffectivenessFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/workflows', () => ({
  listWorkflowsFn: hoisted.listWorkflowsFn,
  getWorkflowFn: vi.fn(),
  listWorkflowVersionsFn: vi.fn(),
  listRunnableWorkflowsFn: vi.fn(),
  createWorkflowFn: vi.fn(),
  updateWorkflowFn: vi.fn(),
  setWorkflowStatusFn: vi.fn(),
  deleteWorkflowFn: vi.fn(),
  reorderWorkflowsFn: hoisted.reorderWorkflowsFn,
}))
vi.mock('@/lib/server/functions/workflow-reporting', () => ({
  workflowEffectivenessFn: hoisted.workflowEffectivenessFn,
  workflowRunsFn: vi.fn(),
  workflowRunTimelineFn: vi.fn(),
}))

import { WorkflowsManager, firstMatchRanks, reorderGroup } from '../workflows-manager'
import { useReorderWorkflows } from '@/lib/client/mutations/workflows'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'

afterEach(cleanup)

const workflow = (id: string, name: string, over: Partial<WorkflowDTO> = {}): WorkflowDTO => ({
  id,
  name,
  class: 'customer_facing',
  status: 'live',
  sortOrder: 0,
  triggerType: 'conversation.created',
  triggerSettings: {},
  graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...over,
})

const GROUP = [
  workflow('workflow_1', 'Welcome tour', { sortOrder: 0 }),
  workflow('workflow_2', 'Billing triage', { sortOrder: 1 }),
  workflow('workflow_3', 'Enterprise greeting', { sortOrder: 2 }),
]

function renderManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <WorkflowsManager />
    </QueryClientProvider>
  )
  return render(ui)
}

describe('reorderGroup', () => {
  it('moves the dragged workflow into the slot it was dropped on', () => {
    const ids = ['a', 'b', 'c']
    expect(reorderGroup(ids, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(reorderGroup(ids, 'a', 'c')).toEqual(['b', 'c', 'a'])
  })

  it('returns null when the drop changes nothing', () => {
    expect(reorderGroup(['a', 'b'], 'a', 'a')).toBeNull()
    expect(reorderGroup(['a', 'b'], 'a', 'missing')).toBeNull()
  })
})

describe('firstMatchRanks', () => {
  it('ranks only the workflows competing for the slot', () => {
    const ranks = firstMatchRanks([
      workflow('a', 'A'),
      workflow('b', 'B', { status: 'paused' }),
      workflow('c', 'C'),
      workflow('d', 'D', { class: 'background' }),
    ])
    // A paused workflow cannot win the slot, and a background one never
    // competes for it, so neither takes a rank from the live pair.
    expect([...ranks]).toEqual([
      ['a', 1],
      ['c', 2],
    ])
  })

  it('ranks nothing when only one workflow can win', () => {
    expect(
      firstMatchRanks([workflow('a', 'A'), workflow('b', 'B', { status: 'draft' })]).size
    ).toBe(0)
  })
})

describe('WorkflowsManager priority list', () => {
  it('shows each competing workflow its first-match rank', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue(GROUP)
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    expect(await screen.findByTitle('First match for this trigger')).toBeTruthy()
    const ranks = await screen.findAllByTestId('first-match-rank')
    expect(ranks.map((el) => el.textContent)).toEqual(['1', '2', '3'])
  })

  it('gives every row in the group a drag handle', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue(GROUP)
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    for (const wf of GROUP) {
      expect(await screen.findByLabelText(`Reorder ${wf.name}`)).toBeTruthy()
    }
  })

  it('cannot reorder a filtered list, where the visible order is a subset', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue(GROUP)
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    // 'i' hides "Welcome tour" and leaves the other two.
    await userEvent.type(await screen.findByLabelText('Search workflows'), 'i')
    const handle = await screen.findByLabelText('Reorder Billing triage')
    expect(handle.getAttribute('disabled')).not.toBeNull()
    expect(screen.queryByLabelText('Reorder Welcome tour')).toBeNull()
  })

  it('offers no handle where there is no order to set', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue([GROUP[0]])
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    await screen.findByText('Welcome tour')
    expect(screen.queryByLabelText('Reorder Welcome tour')).toBeNull()
  })
})

describe('useReorderWorkflows', () => {
  const renderReorder = (queryClient: QueryClient) =>
    renderHook(() => useReorderWorkflows(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

  it('holds the dropped order while the write is in flight', async () => {
    let settle = (): void => {}
    hoisted.reorderWorkflowsFn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = () => resolve()
        })
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['workflows'], GROUP)
    const { result } = renderReorder(queryClient)

    result.current.mutate({ ids: ['workflow_3', 'workflow_1', 'workflow_2'] })

    await waitFor(() =>
      expect(queryClient.getQueryData<typeof GROUP>(['workflows'])?.map((wf) => wf.id)).toEqual([
        'workflow_3',
        'workflow_1',
        'workflow_2',
      ])
    )
    settle()
  })

  it('restores the previous order when the write fails', async () => {
    hoisted.reorderWorkflowsFn.mockRejectedValue(new Error('nope'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(['workflows'], GROUP)
    const { result } = renderReorder(queryClient)

    result.current.mutate({ ids: ['workflow_3', 'workflow_1', 'workflow_2'] })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(queryClient.getQueryData<typeof GROUP>(['workflows'])?.map((wf) => wf.id)).toEqual([
      'workflow_1',
      'workflow_2',
      'workflow_3',
    ])
  })

  it('persists the group order the drop produced', async () => {
    hoisted.reorderWorkflowsFn.mockResolvedValue(undefined)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderReorder(queryClient)

    result.current.mutate({ ids: reorderGroup(['a', 'b', 'c'], 'c', 'a')! })

    await waitFor(() =>
      expect(hoisted.reorderWorkflowsFn).toHaveBeenCalledWith({ data: { ids: ['c', 'a', 'b'] } })
    )
  })
})
