// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const updateCopilotKnowledge = vi.fn()
const updateAgentKnowledge = vi.fn()
const updateCopilotCapabilities = vi.fn()

const config = {
  version: 3 as const,
  identity: { name: 'Quinn', avatarUrl: null },
  agents: {
    agent: {
      voice: {
        tone: 'balanced' as const,
        responseLength: 'balanced' as const,
        additionalInstructions: '',
      },
      knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
    },
    copilot: {
      capabilities: { qa: true, suggestedReplies: true },
      knowledge: {
        helpCenter: true,
        posts: true,
        pastConversations: true,
        internalNotes: true,
        tickets: false,
        changelog: false,
        status: true,
      },
    },
  },
}

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({ config, revision: 4, managedFieldPaths: [] })),
  updateAssistantIdentityFn: vi.fn(),
  updateAssistantVoiceFn: vi.fn(),
  updateAssistantAgentKnowledgeFn: (input: { data: unknown }) => {
    updateAgentKnowledge(input)
    return { config, revision: 5 }
  },
  updateAssistantCopilotKnowledgeFn: (input: { data: unknown }) => {
    updateCopilotKnowledge(input)
    return { config, revision: 5 }
  },
  updateAssistantCopilotCapabilitiesFn: (input: { data: unknown }) => {
    updateCopilotCapabilities(input)
    return { config, revision: 5 }
  },
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

import { AgentKnowledgeCard, CopilotKnowledgeCard } from '../assistant-knowledge-card'
import { CopilotCapabilitiesCard } from '../copilot-capabilities-card'
import { CopilotDeploymentCard } from '../copilot-deployment-card'

afterEach(() => {
  cleanup()
  updateCopilotKnowledge.mockReset()
  updateAgentKnowledge.mockReset()
  updateCopilotCapabilities.mockReset()
})

function renderWithProviders(node: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('CopilotCapabilitiesCard', () => {
  it('renders both capabilities and the Agent-voice note', async () => {
    renderWithProviders(<CopilotCapabilitiesCard />)
    expect(await screen.findByText('Answer questions')).toBeInTheDocument()
    expect(screen.getByText('Suggest reply drafts')).toBeInTheDocument()
    expect(screen.getByText(/Drafts use the Agent’s voice/)).toBeInTheDocument()
    expect(screen.getByText(/works out of the box/)).toBeInTheDocument()
  })

  it('persists a capability toggle', async () => {
    renderWithProviders(<CopilotCapabilitiesCard />)
    await screen.findByText('Answer questions')
    // Toggle "Suggest reply drafts" off.
    fireEvent.click(screen.getByLabelText('Suggest reply drafts'))
    await waitFor(() => expect(updateCopilotCapabilities).toHaveBeenCalledTimes(1))
    expect(updateCopilotCapabilities.mock.calls[0][0].data.capabilities).toEqual({
      qa: true,
      suggestedReplies: false,
    })
  })
})

describe('CopilotKnowledgeCard', () => {
  it('lists all seven live sources (toggles are wired into the runtime)', async () => {
    renderWithProviders(<CopilotKnowledgeCard />)
    expect(await screen.findByText('Help center')).toBeInTheDocument()
    expect(screen.getByText('Past conversations')).toBeInTheDocument()
    expect(screen.getByText('Internal notes')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByText('Changelog')).toBeInTheDocument()
    expect(screen.getByText('System status')).toBeInTheDocument()
    // The config-only rollout hint is gone now that toggles drive the toolset.
    expect(
      screen.queryByText(/take effect when Quinn’s knowledge tools roll out/)
    ).not.toBeInTheDocument()
    // Status is a live lookup, not an index.
    expect(screen.getByText(/Live lookup/)).toBeInTheDocument()
  })

  it('persists a source toggle against the copilot knowledge map', async () => {
    renderWithProviders(<CopilotKnowledgeCard />)
    await screen.findByText('Tickets')
    fireEvent.click(screen.getByLabelText('Use Tickets'))
    await waitFor(() => expect(updateCopilotKnowledge).toHaveBeenCalledTimes(1))
    expect(updateCopilotKnowledge.mock.calls[0][0].data.knowledge.tickets).toBe(true)
  })
})

describe('AgentKnowledgeCard', () => {
  it('offers only the four agent sources and the public-board caveat', async () => {
    renderWithProviders(<AgentKnowledgeCard />)
    expect(await screen.findByText('Help center')).toBeInTheDocument()
    expect(screen.getByText('Feedback posts')).toBeInTheDocument()
    expect(screen.getByText('Changelog')).toBeInTheDocument()
    expect(screen.getByText('System status')).toBeInTheDocument()
    // Team-only sources are never offered to the Agent (D8).
    expect(screen.queryByText('Past conversations')).not.toBeInTheDocument()
    expect(screen.queryByText('Internal notes')).not.toBeInTheDocument()
    expect(screen.queryByText('Tickets')).not.toBeInTheDocument()
    expect(screen.getByText(/Public feedback boards only/)).toBeInTheDocument()
  })
})

describe('CopilotDeploymentCard', () => {
  it('reads on/off from capabilities', async () => {
    renderWithProviders(<CopilotDeploymentCard available />)
    expect(await screen.findByText('On')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off Copilot' })).toBeInTheDocument()
  })

  it('shows Unavailable when the inbox AI gate is off', async () => {
    renderWithProviders(<CopilotDeploymentCard available={false} />)
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off Copilot' })).not.toBeInTheDocument()
  })
})
