// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        tone: 'balanced' as const,
        responseLength: 'balanced' as const,
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

import { AdditionalInstructionsCard } from '../additional-instructions-card'
import { assistantKeys } from '@/lib/client/queries/assistant'
import { AssistantDirtyStateProvider, useAssistantDirtyState } from '../assistant-form'

afterEach(() => {
  cleanup()
  updateVoice.mockReset()
  toastError.mockReset()
})

let queryClient: QueryClient

function DirtySummary() {
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  return (
    <output aria-label="dirty">
      {hasUnsavedChanges ? 'Unsaved' : 'Clean'}: {Array.from(dirtyTabs).join(',')}
    </output>
  )
}

function renderCard() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: createAutosaveMutationCache(),
  })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AssistantDirtyStateProvider>
          <AdditionalInstructionsCard />
          <DirtySummary />
        </AssistantDirtyStateProvider>
      </QueryClientProvider>
    </IntlProvider>
  )
}

function savedInstructions(additionalInstructions: string, revision: number) {
  return {
    config: {
      ...config,
      agents: {
        ...config.agents,
        agent: {
          ...config.agents.agent,
          voice: { ...config.agents.agent.voice, additionalInstructions },
        },
      },
    },
    revision,
  }
}

const FIELD = 'Guidelines used in every response'
const slow = { timeout: 3000 }

it('presents writing guidelines with an accessible field label', async () => {
  renderCard()

  expect(await screen.findByRole('heading', { name: 'Writing guidelines' })).toBeInTheDocument()
  expect(
    await screen.findByRole('textbox', { name: 'Guidelines used in every response' })
  ).toHaveValue('Use UK English.')
})

it('saves typed guidelines after a pause, trimmed, keeping the rest of the voice', async () => {
  updateVoice.mockResolvedValue({
    config: {
      ...config,
      agents: {
        ...config.agents,
        agent: {
          ...config.agents.agent,
          voice: { ...config.agents.agent.voice, additionalInstructions: 'Use US English.' },
        },
      },
    },
    revision: 3,
  })
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  fireEvent.change(field, { target: { value: '  Use US English.  ' } })
  expect(updateVoice).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
  await waitFor(() => expect(updateVoice).toHaveBeenCalledTimes(1), slow)
  expect(updateVoice).toHaveBeenCalledWith({
    data: {
      expectedRevision: 2,
      voice: {
        tone: 'balanced',
        responseLength: 'balanced',
        additionalInstructions: 'Use US English.',
      },
    },
  })
  // The saved text is the trimmed value, so nothing is left to save.
  await new Promise((resolve) => setTimeout(resolve, 1200))
  expect(updateVoice).toHaveBeenCalledTimes(1)
  // What the user typed stays in the field; the server keeps the trimmed text.
  expect(field).toHaveValue('  Use US English.  ')
})

it('keeps a newline typed while the text before it is being saved', async () => {
  let release: (value: unknown) => void = () => {}
  updateVoice.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  fireEvent.change(field, { target: { value: 'Use US English.' } })
  await waitFor(() => expect(updateVoice).toHaveBeenCalledTimes(1), slow)
  fireEvent.change(field, { target: { value: 'Use US English.\n' } })
  await act(async () => release(savedInstructions('Use US English.', 3)))
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(field).toHaveValue('Use US English.\n')
  fireEvent.change(field, { target: { value: 'Use US English.\nAvoid jargon.' } })
  await waitFor(() => expect(updateVoice).toHaveBeenCalledTimes(2), slow)
  await act(async () => release(savedInstructions('Use US English.\nAvoid jargon.', 4)))
  expect(field).toHaveValue('Use US English.\nAvoid jargon.')
})

it('takes a change made in another session only while the field is not being edited', async () => {
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  const external = savedInstructions('Keep it short.', 3)
  fireEvent.focus(field)
  act(() => {
    queryClient.setQueryData(assistantKeys.settings(), { ...external, managedFieldPaths: [] })
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(field).toHaveValue('Use UK English.')
  fireEvent.blur(field)
  await waitFor(() => expect(field).toHaveValue('Keep it short.'))
  expect(updateVoice).not.toHaveBeenCalled()
})

it('reports unsaved edits, including one being saved, so leaving the page is guarded', async () => {
  let release: (value: unknown) => void = () => {}
  updateVoice.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  expect(screen.getByLabelText('dirty')).toHaveTextContent('Clean')
  fireEvent.change(field, { target: { value: 'Use US English.' } })
  expect(screen.getByLabelText('dirty')).toHaveTextContent('Unsaved: basics')
  await waitFor(() => expect(updateVoice).toHaveBeenCalledTimes(1), slow)
  expect(screen.getByLabelText('dirty')).toHaveTextContent('Unsaved: basics')
  await act(async () => release(savedInstructions('Use US English.', 3)))
  await waitFor(() => expect(screen.getByLabelText('dirty')).toHaveTextContent('Clean'))
})

it('does not save guidelines over the length limit', async () => {
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  fireEvent.change(field, { target: { value: 'x'.repeat(2001) } })
  expect(await screen.findByText('Use 2,000 characters or fewer.')).toBeInTheDocument()
  await new Promise((resolve) => setTimeout(resolve, 1200))
  expect(updateVoice).not.toHaveBeenCalled()
})

it('shows one failure toast and keeps the draft', async () => {
  updateVoice.mockRejectedValue(new Error('boom'))
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  fireEvent.change(field, { target: { value: 'Something new' } })
  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1), slow)
  expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
  expect(field).toHaveValue('Something new')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  expect(updateVoice).toHaveBeenCalledTimes(1)
})

it('surfaces a conflict without overwriting and reloads the latest guidelines', async () => {
  // A failing server function reaches the client as a plain Error with the server's message.
  updateVoice.mockRejectedValue(new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE))
  renderCard()
  const field = await screen.findByRole('textbox', { name: FIELD })
  fireEvent.change(field, { target: { value: 'Something new' } })
  const alert = await screen.findByRole('alert', {}, slow)
  expect(alert).toHaveTextContent(/changed in another session/)
  expect(toastError).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest settings' }))
  await waitFor(() => expect(field).toHaveValue('Use UK English.'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(updateVoice).toHaveBeenCalledTimes(1)
})
