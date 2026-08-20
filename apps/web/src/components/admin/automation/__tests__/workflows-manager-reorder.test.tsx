// @vitest-environment happy-dom
/**
 * Priority reordering in the workflows manager (support platform §4.6).
 * Customer-facing workflows share one first-match list in stored order
 * (including draft/paused); background workflows are unranked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, renderHook, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouteContext: () => ({ settings: { featureFlags: {}, publicWidgetConfig: {} } }),
}))

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

import {
  WorkflowsManager,
  firstMatchRanks,
  needsSetupBadgeText,
  reorderGroup,
} from '../workflows-manager'
import { useReorderWorkflows } from '@/lib/client/mutations/workflows'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'
import { treeToGraph, createStep, newTree, insertStepAt, ROOT_LOCATION } from '../workflow-graph'

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
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <WorkflowsManager />
      </QueryClientProvider>
    </IntlProvider>
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
  it('ranks every customer-facing workflow in stored order, including drafts', () => {
    const ranks = firstMatchRanks([
      workflow('a', 'A'),
      workflow('b', 'B', { status: 'paused' }),
      workflow('c', 'C', { status: 'draft' }),
      workflow('d', 'D', { class: 'background' }),
    ])
    expect([...ranks]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('ranks a lone customer-facing workflow as 1', () => {
    expect([...firstMatchRanks([workflow('a', 'A')])]).toEqual([['a', 1]])
  })
})

describe('needsSetupBadgeText', () => {
  it('uses branch-option phrasing only when every issue is an unset path', () => {
    expect(needsSetupBadgeText({ branchOptions: 2, other: 0 })).toBe(
      'Needs setup · 2 branch options'
    )
    expect(needsSetupBadgeText({ branchOptions: 1, other: 0 })).toBe(
      'Needs setup · 1 branch option'
    )
  })

  it('falls back to a count when issues are mixed or generic', () => {
    expect(needsSetupBadgeText({ branchOptions: 0, other: 2 })).toBe('Needs setup · 2')
    expect(needsSetupBadgeText({ branchOptions: 2, other: 1 })).toBe('Needs setup · 3')
  })
})

describe('WorkflowsManager class list', () => {
  it('groups by class and ranks customer-facing rows in visual order', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue([
      ...GROUP,
      workflow('workflow_bg', 'Nightly sweep', { class: 'background', sortOrder: 3 }),
    ])
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    expect(await screen.findByText('Customer-facing')).toBeTruthy()
    expect(screen.getByText('Background')).toBeTruthy()
    expect(screen.getByText('Priority when live · drafts do not run')).toBeTruthy()
    const ranks = await screen.findAllByTestId('first-match-rank')
    expect(ranks.map((el) => el.textContent)).toEqual(['1', '2', '3'])
    expect(screen.queryByLabelText('Reorder Nightly sweep')).toBeNull()
  })

  it('gives every customer-facing row a drag handle when there are two or more', async () => {
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

    await userEvent.type(await screen.findByLabelText('Search workflows…'), 'i')
    const handle = await screen.findByLabelText('Reorder Billing triage')
    expect(handle.getAttribute('disabled')).not.toBeNull()
    expect(screen.queryByLabelText('Reorder Welcome tour')).toBeNull()
    expect(screen.queryByText('Priority when live · drafts do not run')).toBeNull()
  })

  it('offers no handle where there is no order to set', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue([GROUP[0]])
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    await screen.findByText('Welcome tour')
    expect(screen.queryByLabelText('Reorder Welcome tour')).toBeNull()
    expect(screen.getByTestId('first-match-rank').textContent).toBe('1')
  })

  it('omits the customer-facing group when every workflow is background', async () => {
    hoisted.listWorkflowsFn.mockResolvedValue([
      workflow('workflow_bg', 'Nightly sweep', { class: 'background' }),
    ])
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    expect(await screen.findByText('Nightly sweep')).toBeTruthy()
    expect(screen.queryByText('Customer-facing')).toBeNull()
    expect(screen.getByText('Background')).toBeTruthy()
    expect(screen.queryByText('Priority when live · drafts do not run')).toBeNull()
  })

  it('badges a branch with unset options as needs setup', async () => {
    let tree = newTree()
    const branch = createStep(tree, 'branch')
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)
    hoisted.listWorkflowsFn.mockResolvedValue([
      workflow('workflow_route', 'Route by issue type', {
        class: 'background',
        graph: treeToGraph(tree) as WorkflowDTO['graph'],
      }),
    ])
    hoisted.workflowEffectivenessFn.mockResolvedValue([])
    renderManager()

    expect(await screen.findByText('Needs setup · 2 branch options')).toBeTruthy()
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
