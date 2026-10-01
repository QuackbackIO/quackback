// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { IntlProvider } from 'react-intl'
import { ASSISTANT_REVISION_CONFLICT_MESSAGE } from '@/lib/shared/assistant/config'

const updateVoice = vi.fn()
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
const config = {
  version: 3 as const,
  identity: { name: 'Quinn', avatarUrl: null },
  agents: {
    agent: {
      voice: {
        tone: 'warm' as const,
        responseLength: 'brief' as const,
        additionalInstructions: 'Use UK English.',
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
  getAssistantSettingsFn: vi.fn(async () => ({ config, revision: 2, managedFieldPaths: [] })),
  updateAssistantIdentityFn: vi.fn(),
  updateAssistantVoiceFn: (input: { data: unknown }) => updateVoice(input),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

import { AssistantVoiceCard } from '../assistant-basics-card'

afterEach(() => {
  cleanup()
  updateVoice.mockReset()
  toastError.mockReset()
})

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: createAutosaveMutationCache(),
  })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AssistantVoiceCard />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('AssistantVoiceCard', () => {
  it('renders described semantic radio groups from persisted V3 values', async () => {
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Response style' })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Warm/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Brief/ })).toBeChecked()
    expect(screen.getByText('Friendly, empathetic, and conversational.')).toBeInTheDocument()
  })

  function savedAs(tone: string, revision: number) {
    return {
      config: {
        ...config,
        agents: {
          ...config.agents,
          agent: {
            ...config.agents.agent,
            voice: { ...config.agents.agent.voice, tone },
          },
        },
      },
      revision,
    }
  }

  it('has no Save button and saves a chosen tile straight away with its revision', async () => {
    updateVoice.mockResolvedValue(savedAs('professional', 3))
    renderCard()
    fireEvent.click(await screen.findByRole('radio', { name: /Professional/ }))
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(updateVoice).toHaveBeenCalledWith({
        data: {
          expectedRevision: 2,
          voice: {
            tone: 'professional',
            responseLength: 'brief',
            additionalInstructions: 'Use UK English.',
          },
        },
      })
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows one failure toast, keeps the choice and does not retry on its own', async () => {
    updateVoice.mockRejectedValue(new Error('boom'))
    renderCard()
    fireEvent.click(await screen.findByRole('radio', { name: /Professional/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    expect(screen.getByRole('radio', { name: /Professional/ })).toBeChecked()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(updateVoice).toHaveBeenCalledTimes(1)
  })

  it('sends the same choice again when it is picked again after a failed save', async () => {
    updateVoice
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(savedAs('professional', 3))
    renderCard()
    fireEvent.click(await screen.findByRole('radio', { name: /Professional/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(updateVoice).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Polished and more formal.'))
    await waitFor(() => expect(updateVoice).toHaveBeenCalledTimes(2))
    expect(updateVoice.mock.calls[1]![0]).toEqual(updateVoice.mock.calls[0]![0])
  })

  it('surfaces a conflict without overwriting, then reloads the latest settings', async () => {
    // A failing server function reaches the client as a plain Error with the server's message.
    updateVoice.mockRejectedValue(new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE))
    renderCard()
    fireEvent.click(await screen.findByRole('radio', { name: /Professional/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/changed in another session/)
    expect(toastError).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(updateVoice).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reload latest settings' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Warm/ })).toBeChecked())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(updateVoice).toHaveBeenCalledTimes(1)
  })
})
