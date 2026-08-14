// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConnectorPublicDTO } from '@/lib/server/domains/assistant/connectors.service'

const createConnector = vi.fn()

let connectorsData: ConnectorPublicDTO[] = []

vi.mock('@/lib/client/queries/assistant', () => ({
  assistantKeys: {
    connectors: () => ['assistant', 'connectors'],
  },
  assistantQueries: {
    connectors: () => ({
      queryKey: ['assistant', 'connectors'],
      queryFn: async () => connectorsData,
    }),
  },
}))

vi.mock('@/lib/server/functions/assistant-connectors', () => ({
  createConnectorFn: (args: unknown) => createConnector(args),
  updateConnectorFn: vi.fn(),
  deleteConnectorFn: vi.fn(),
  syncConnectorFn: vi.fn(),
  updateConnectorToolRuleFn: vi.fn(),
}))

import { ConnectorsCard } from '../connectors-card'

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ConnectorsCard agent="agent" />
      </IntlProvider>
    </QueryClientProvider>
  )
}

function dto(over: Partial<ConnectorPublicDTO> = {}): ConnectorPublicDTO {
  return {
    id: 'assistant_connector_1',
    name: 'Tracker',
    slug: 'tracker',
    url: 'https://mcp.example.com/mcp',
    hasAuthToken: false,
    tools: [{ name: 'create_issue', description: 'Create an issue', inputSchemaJson: '{}' }],
    toolRules: { create_issue: 'allow' },
    assignments: { agent: true, copilot: true },
    enabled: true,
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

afterEach(() => {
  cleanup()
  connectorsData = []
  createConnector.mockReset()
})

describe('ConnectorsCard', () => {
  it('keeps unassigned connectors visible and expands from the name', async () => {
    const user = userEvent.setup()
    connectorsData = [dto({ assignments: { agent: false, copilot: true } })]
    renderCard()

    expect(await screen.findByText('Tracker')).toBeInTheDocument()
    expect(screen.getByText('Not assigned to this agent')).toBeInTheDocument()

    await user.click(screen.getByText('Tracker'))
    expect(await screen.findByText('create_issue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('blocks create until the URL is http(s) and sends assignment choices', async () => {
    const user = userEvent.setup()
    createConnector.mockResolvedValue(dto())
    renderCard()

    await user.click((await screen.findAllByRole('button', { name: 'Add connector' }))[0])
    await user.type(screen.getByLabelText('Name'), 'Tracker')
    const submit = screen.getAllByRole('button', { name: 'Add connector' }).at(-1)!
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('MCP server URL'), 'not-a-url')
    expect(screen.getByText(/Enter an http\(s\) URL/i)).toBeInTheDocument()
    expect(submit).toBeDisabled()

    await user.clear(screen.getByLabelText('MCP server URL'))
    await user.type(screen.getByLabelText('MCP server URL'), 'https://mcp.example.com/mcp')
    await user.click(screen.getByLabelText('Enable for Copilot'))
    await user.click(submit)

    expect(createConnector).toHaveBeenCalledWith({
      data: {
        name: 'Tracker',
        url: 'https://mcp.example.com/mcp',
        authToken: null,
        assignments: { agent: true, copilot: false },
        enabled: true,
      },
    })
  })
})
