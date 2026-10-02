// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { IntlProvider } from 'react-intl'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

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
      capabilities: { qa: true },
      knowledge: {
        helpCenter: true,
        posts: true,
        pastConversations: true,
        internalNotes: true,
        tickets: true,
        changelog: true,
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

import { getAssistantSettingsFn } from '@/lib/server/functions/assistant-settings'
import { AgentKnowledgeCard, CopilotKnowledgeCard } from '../assistant-knowledge-card'
import { CopilotPauseControl, useCopilotStatusLine } from '../copilot-deployment-card'

afterEach(() => {
  cleanup()
  updateCopilotKnowledge.mockReset()
  updateAgentKnowledge.mockReset()
  updateCopilotCapabilities.mockReset()
  toastError.mockReset()
  vi.mocked(getAssistantSettingsFn).mockClear()
  vi.mocked(getAssistantSettingsFn).mockImplementation(
    async () => ({ config, revision: 4, managedFieldPaths: [] }) as never
  )
})

function renderWithProviders(node: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: createAutosaveMutationCache(),
  })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

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
    // Status is a live lookup, not an index; indexed sources carry no badge.
    expect(screen.getAllByText('Live lookup')).toHaveLength(1)
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })

  it('is one card without a header, since the tab is already called Knowledge', async () => {
    renderWithProviders(<CopilotKnowledgeCard />)
    await screen.findByText('Tickets')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('puts a failed toggle back and shows the one autosave toast', async () => {
    updateCopilotKnowledge.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    renderWithProviders(<CopilotKnowledgeCard />)
    await screen.findByText('Tickets')
    fireEvent.click(screen.getByLabelText('Use Tickets'))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    await waitFor(() => expect(screen.getByLabelText('Use Tickets')).toBeChecked())
  })

  it('refreshes the settings after a revision conflict so a retry can succeed', async () => {
    updateCopilotKnowledge.mockImplementationOnce(() => {
      throw Object.assign(new Error('changed in another session'), { statusCode: 409 })
    })
    renderWithProviders(<CopilotKnowledgeCard />)
    await screen.findByText('Tickets')
    const loads = vi.mocked(getAssistantSettingsFn).mock.calls.length
    fireEvent.click(screen.getByLabelText('Use Tickets'))
    await waitFor(() =>
      expect(vi.mocked(getAssistantSettingsFn).mock.calls.length).toBeGreaterThan(loads)
    )
    await waitFor(() => expect(screen.getByLabelText('Use Tickets')).toBeChecked())
  })

  it('persists a source toggle against the copilot knowledge map', async () => {
    renderWithProviders(<CopilotKnowledgeCard />)
    await screen.findByText('Tickets')
    fireEvent.click(screen.getByLabelText('Use Tickets'))
    await waitFor(() => expect(updateCopilotKnowledge).toHaveBeenCalledTimes(1))
    expect(updateCopilotKnowledge.mock.calls[0][0].data.knowledge.tickets).toBe(false)
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

function CopilotHeader({ available }: { available?: boolean }) {
  // `available` is omitted to read it from the settings, as the route does.
  const line = useCopilotStatusLine(available)
  return (
    <>
      <p data-testid="line">{line}</p>
      <CopilotPauseControl available={available} />
    </>
  )
}

describe('Copilot pause control', () => {
  it('offers Pause Copilot and a quiet status line while on', async () => {
    renderWithProviders(<CopilotHeader available />)
    expect(await screen.findByRole('button', { name: 'Pause Copilot' })).toBeInTheDocument()
    expect(screen.getByTestId('line')).toHaveTextContent('Available to teammates in the inbox')
  })

  it('pauses after confirming by turning the Q&A capability off', async () => {
    renderWithProviders(<CopilotHeader available />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Copilot' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(updateCopilotCapabilities).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause Copilot' }))
    await waitFor(() => expect(updateCopilotCapabilities).toHaveBeenCalledTimes(1))
    expect(updateCopilotCapabilities.mock.calls[0][0].data).toEqual({
      expectedRevision: 4,
      capabilities: { qa: false },
    })
  })

  it('shows the one autosave toast on failure and keeps the dialog open', async () => {
    updateCopilotCapabilities.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    renderWithProviders(<CopilotHeader available />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Copilot' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause Copilot' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('hides the control when no AI model is configured', async () => {
    renderWithProviders(<CopilotHeader available={false} />)
    expect(await screen.findByTestId('line')).toHaveTextContent(/Configure an AI model/)
    expect(screen.queryByRole('button', { name: 'Pause Copilot' })).not.toBeInTheDocument()
  })

  it('reads availability from the settings when the page does not pass it', async () => {
    vi.mocked(getAssistantSettingsFn).mockResolvedValue({
      config,
      revision: 4,
      managedFieldPaths: [],
      aiAvailable: false,
    } as never)
    renderWithProviders(<CopilotHeader />)
    await waitFor(() =>
      expect(screen.getByTestId('line')).toHaveTextContent(/Configure an AI model/)
    )
    expect(screen.queryByRole('button', { name: 'Pause Copilot' })).not.toBeInTheDocument()
  })

  it('offers the control when the settings report a configured model', async () => {
    vi.mocked(getAssistantSettingsFn).mockResolvedValue({
      config,
      revision: 4,
      managedFieldPaths: [],
      aiAvailable: true,
    } as never)
    renderWithProviders(<CopilotHeader />)
    expect(await screen.findByRole('button', { name: 'Pause Copilot' })).toBeInTheDocument()
    expect(screen.getByTestId('line')).toHaveTextContent('Available to teammates in the inbox')
  })
})
