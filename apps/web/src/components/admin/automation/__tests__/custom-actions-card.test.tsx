// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { AssistantActionDTO } from '@/lib/shared/assistant/custom-actions'

const mutations = { create: vi.fn(), update: vi.fn() }

// The cards read their data through these query factories; stub them with
// queryOptions whose queryFn resolves in-memory so no server fn is invoked.
const toolsData = [
  {
    name: 'end_conversation',
    label: 'End conversation',
    description: 'Close it.',
    risk: 'write' as const,
  },
  {
    name: 'search',
    label: 'Search knowledge',
    description: 'Search KB.',
    risk: 'read' as const,
  },
]
let actionsData: { actions: AssistantActionDTO[] } = { actions: [] }

vi.mock('@/lib/client/queries/assistant', () => ({
  assistantKeys: {
    tools: () => ['assistant', 'tools'],
    customActions: () => ['assistant', 'customActions'],
    settings: () => ['assistant', 'settings'],
    connectors: () => ['assistant', 'connectors'],
  },
  assistantQueries: {
    tools: () => ({ queryKey: ['assistant', 'tools'], queryFn: async () => toolsData }),
    customActions: () => ({
      queryKey: ['assistant', 'customActions'],
      queryFn: async () => actionsData,
    }),
    settings: () => ({
      queryKey: ['assistant', 'settings'],
      queryFn: async () => ({
        revision: 1,
        config: {
          version: 3,
          identity: { name: 'Quinn', avatarUrl: null },
          agents: {
            agent: {
              voice: { tone: 'balanced', responseLength: 'balanced', additionalInstructions: '' },
              knowledge: {
                helpCenter: true,
                posts: false,
                changelog: false,
                documents: true,
                status: false,
              },
              toolRules: {},
            },
            copilot: {
              capabilities: { qa: true },
              knowledge: {
                helpCenter: true,
                posts: true,
                pastConversations: true,
                internalNotes: true,
                tickets: false,
                changelog: false,
                documents: true,
                status: true,
              },
              toolRules: {},
            },
          },
        },
        managedFieldPaths: [],
      }),
    }),
    connectors: () => ({
      queryKey: ['assistant', 'connectors'],
      queryFn: async () => [],
    }),
  },
}))

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  updateAssistantToolRuleFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-connectors', () => ({
  listConnectorsFn: vi.fn(async () => []),
  createConnectorFn: vi.fn(),
  updateConnectorFn: vi.fn(),
  deleteConnectorFn: vi.fn(),
  syncConnectorFn: vi.fn(),
  updateConnectorToolRuleFn: vi.fn(),
}))

vi.mock('@/lib/client/mutations/assistant-custom-actions', () => ({
  useCreateCustomAction: () => ({ mutateAsync: mutations.create, isPending: false }),
  useUpdateCustomAction: () => ({ mutateAsync: mutations.update, isPending: false }),
  useDeleteCustomAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestCustomAction: () => ({ mutateAsync: vi.fn(), isPending: false, reset: vi.fn() }),
}))

import { BuiltInActionsCard } from '../builtin-actions-card'
import { CustomActionsCard } from '../custom-actions-card'

function renderCard(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

const dto = (over: Partial<AssistantActionDTO> = {}): AssistantActionDTO => ({
  id: 'assistant_custom_action_1',
  toolName: 'action_lookup_order',
  name: 'Lookup order',
  whenToUse: 'Look up an order by id.',
  request: { method: 'GET', url: 'https://api.test/x', headers: [], body: null },
  variables: [],
  responseAllowlist: ['status'],
  responseCharLimit: 4000,
  assignments: { agent: true, copilot: false },
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
})

afterEach(() => {
  cleanup()
  actionsData = { actions: [] }
  mutations.create.mockReset()
  mutations.update.mockReset()
})

describe('BuiltInActionsCard', () => {
  it('lists built-in tools with read/write risk badges and permission controls', async () => {
    renderCard(<BuiltInActionsCard agent="agent" />)
    expect(await screen.findByText('End conversation')).toBeInTheDocument()
    expect(screen.getByText('Search knowledge')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText(/same controls as Connectors/i)).toBeInTheDocument()
    // Write tools expose Ask / Always allow / Deny; read tools stay always on.
    expect(screen.getByText('Always on')).toBeInTheDocument()
  })

  it('uses the shared permissions description on the copilot page', async () => {
    renderCard(<BuiltInActionsCard agent="copilot" />)
    await screen.findByText('End conversation')
    expect(screen.getByText(/same controls as Connectors/i)).toBeInTheDocument()
  })
})

describe('CustomActionsCard', () => {
  it('renders the empty state when there are no definitions', async () => {
    renderCard(<CustomActionsCard agent="agent" />)
    expect(await screen.findByText(/Add your first custom action/i)).toBeInTheDocument()
  })

  it('lists a definition with its when-to-use preview', async () => {
    actionsData = { actions: [dto()] }
    renderCard(<CustomActionsCard agent="agent" />)
    expect(await screen.findByText('Lookup order')).toBeInTheDocument()
    expect(screen.getByText(/Look up an order by id/i)).toBeInTheDocument()
  })

  it('surfaces a slug-collision rejection on the name field (not the generic save error)', async () => {
    const user = userEvent.setup()
    mutations.create.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'ASSISTANT_ACTION_DUPLICATE_NAME' })
    )
    renderCard(<CustomActionsCard agent="agent" />)

    // Empty state renders two "New action" buttons (header + card); either opens the dialog.
    await user.click((await screen.findAllByRole('button', { name: /New action/i }))[0])
    await user.type(screen.getByLabelText('Name this action'), 'Lookup order')
    await user.type(
      screen.getByLabelText('When should Quinn use this?'),
      'Call to look up an order.'
    )
    // The dialog is a step wizard: step 0 (define) -> 1 (request) -> 2
    // (response data) -> 3 (assign & test), with the submit button on the
    // last step.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(
      screen.getByPlaceholderText('https://api.example.com/orders/{{orderId}}'),
      'https://api.example.com/orders'
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add action' }))

    expect(mutations.create).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText('Another action already uses a similar name. Choose a distinct name.')
    ).toBeInTheDocument()
    // The generic save error must NOT be shown for this case.
    expect(screen.queryByText(/The custom action could not be saved/i)).not.toBeInTheDocument()
  })
})
