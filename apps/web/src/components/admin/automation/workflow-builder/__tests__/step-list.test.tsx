// @vitest-environment happy-dom
/**
 * Smoke coverage for the step list: renders the trigger card and a trailing
 * "Add step" for an empty tree, and wires clicks through to the
 * select/insert callbacks. Tree derivation itself is covered by tree-walk.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  ROOT_LOCATION,
  createStep,
  insertStepAt,
  newTree,
  type TreeStep,
} from '../../workflow-graph'
import { WorkflowEntitiesProvider } from '../entities'
import { StepList } from '../step-list'

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
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    workflowAbandonedAutoClose: () => ({
      queryKey: ['test', 'abandoned'],
      queryFn: async () => ({ enabled: false, waitMinutes: 5, keepIfEmailCaptured: true }),
    }),
  },
}))

afterEach(cleanup)

function renderList(props: Partial<Parameters<typeof StepList>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelectNode = vi.fn()
  const onSelectInsertion = vi.fn()
  const onRemoveStep = vi.fn()
  const utils = render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <WorkflowEntitiesProvider>
          <StepList
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
    </IntlProvider>
  )
  return { ...utils, onSelectNode, onSelectInsertion, onRemoveStep }
}

describe('StepList', () => {
  it('renders the trigger card and a trailing Add step for an empty tree', async () => {
    renderList()
    expect(await screen.findByText('New conversation')).toBeInTheDocument()
    expect(await screen.findByText('Trigger')).toBeInTheDocument()
    expect(await screen.findByText('Start')).toBeInTheDocument()
    expect(await screen.findByText('Add step')).toBeInTheDocument()
  })

  it('selects the trigger card on click', async () => {
    const { onSelectNode } = renderList()
    const trigger = await screen.findByText('New conversation')
    fireEvent.click(trigger)
    expect(onSelectNode).toHaveBeenCalledWith('trigger')
  })

  it('opens the palette at the root insertion point via the Add step node', async () => {
    const { onSelectInsertion } = renderList()
    const add = await screen.findByText('Add step')
    fireEvent.click(add)
    expect(onSelectInsertion).toHaveBeenCalledWith(ROOT_LOCATION, 0)
  })

  it('renders a branch card and a lane tab for every path key', async () => {
    let tree = newTree()
    const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)

    renderList({ tree })

    expect(await screen.findByText('2 paths')).toBeInTheDocument()
    expect(await screen.findByText('Branch · first match')).toBeInTheDocument()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs).toHaveLength(branch.paths.length)
  })

  it('shows the warn icon and amber ring context for a step with an issue', async () => {
    let tree = newTree()
    const action: TreeStep = {
      id: 'act-1',
      kind: 'action',
      action: { type: 'assign_team', teamId: '' },
    }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, action)

    renderList({ tree, stepIssues: new Map([['act-1', 'Choose a team to assign']]) })

    const card = await screen.findByText('Assign to team')
    expect(card.closest('button')).toHaveClass('border-amber-500/60')
  })
})
