// @vitest-environment happy-dom
/**
 * Smoke coverage for the React Flow canvas: renders the trigger card and a
 * trailing "Add step" node for an empty tree, and wires clicks through to the
 * select/insert callbacks. This is the "the builder must render" gate from
 * the React Flow rebuild brief — the layout math itself is covered
 * exhaustively (and independent of React/RF) by flow-layout.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ROOT_LOCATION,
  createStep,
  insertStepAt,
  newTree,
  type TreeStep,
} from '../../workflow-graph'
import { WorkflowEntitiesProvider } from '../entities'
import { WorkflowBuilderCanvas } from '../canvas'

// The canvas only needs entities for id -> display-name lookups; keep the
// provider's own data hooks trivial so this test doesn't have to pull in the
// full inbox nav sidebar / server functions those hooks normally call.
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

afterEach(cleanup)

function renderCanvas(props: Partial<Parameters<typeof WorkflowBuilderCanvas>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelectNode = vi.fn()
  const onSelectInsertion = vi.fn()
  const onRemoveStep = vi.fn()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>
        <WorkflowBuilderCanvas
          tree={newTree()}
          triggerLabel="New conversation"
          triggerChannels={[]}
          selection={null}
          stepIssues={new Map()}
          onSelectNode={onSelectNode}
          onSelectInsertion={onSelectInsertion}
          onRemoveStep={onRemoveStep}
          {...props}
        />
      </WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
  return { ...utils, onSelectNode, onSelectInsertion, onRemoveStep }
}

describe('WorkflowBuilderCanvas (React Flow)', () => {
  it('renders the trigger card and a trailing Add step node for an empty tree', async () => {
    renderCanvas()
    expect(await screen.findByText('New conversation')).toBeInTheDocument()
    expect(await screen.findByText('Trigger')).toBeInTheDocument()
    expect(await screen.findByText('Start')).toBeInTheDocument()
    expect(await screen.findByText('Add step')).toBeInTheDocument()
  })

  it('selects the trigger card on click', async () => {
    const { onSelectNode } = renderCanvas()
    const trigger = await screen.findByText('New conversation')
    fireEvent.click(trigger)
    expect(onSelectNode).toHaveBeenCalledWith('trigger')
  })

  it('opens the palette at the root insertion point via the Add step node', async () => {
    const { onSelectInsertion } = renderCanvas()
    const add = await screen.findByText('Add step')
    fireEvent.click(add)
    expect(onSelectInsertion).toHaveBeenCalledWith(ROOT_LOCATION, 0)
  })

  it('renders a branch card, its rule pills, and the path steps', async () => {
    let tree = newTree()
    const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)

    renderCanvas({ tree })

    expect(await screen.findByText('2 paths')).toBeInTheDocument()
    expect(await screen.findByText('Branch · first match')).toBeInTheDocument()
    expect(await screen.findByText(branch.paths[0]!.key)).toBeInTheDocument()
    expect(await screen.findByText(branch.paths[1]!.key)).toBeInTheDocument()
  })

  it('shows the warn icon and amber ring context for a step with an issue', async () => {
    let tree = newTree()
    const action: TreeStep = {
      id: 'act-1',
      kind: 'action',
      action: { type: 'assign_team', teamId: '' },
    }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, action)

    renderCanvas({ tree, stepIssues: new Map([['act-1', 'Choose a team to assign']]) })

    const card = await screen.findByText('Assign to team')
    expect(card.closest('button')).toHaveClass('border-amber-500/60')
  })
})
