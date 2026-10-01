// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { IntlProvider } from 'react-intl'
import { ASSISTANT_REVISION_CONFLICT_MESSAGE } from '@/lib/shared/assistant/config'

const updateIdentity = vi.fn()
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
const config = {
  version: 2 as const,
  identity: { name: 'Quinn', avatarUrl: null },
  voice: {
    tone: 'balanced' as const,
    responseLength: 'balanced' as const,
    additionalInstructions: '',
  },
}

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({ config, revision: 3, managedFieldPaths: [] })),
  updateAssistantIdentityFn: (input: { data: unknown }) => updateIdentity(input),
  updateAssistantVoiceFn: vi.fn(),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/uploads', () => ({
  getAssistantAvatarUploadUrlFn: vi.fn(),
}))

import { getAssistantSettingsFn } from '@/lib/server/functions/assistant-settings'
import { AssistantIdentityCard } from '../assistant-identity-card'
import { assistantKeys } from '@/lib/client/queries/assistant'
import { AssistantDirtyStateProvider, useAssistantDirtyState } from '../assistant-form'

afterEach(() => {
  cleanup()
  updateIdentity.mockReset()
  toastError.mockReset()
})

const slow = { timeout: 3000 }

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
          <AssistantIdentityCard />
          <DirtySummary />
        </AssistantDirtyStateProvider>
      </QueryClientProvider>
    </IntlProvider>
  )
}

function savedName(name: string, revision: number) {
  return { config: { ...config, identity: { ...config.identity, name } }, revision }
}

describe('AssistantIdentityCard', () => {
  it('loads the V2 identity with an upload flow instead of a URL input', async () => {
    renderCard()
    expect(await screen.findByDisplayValue('Quinn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload image/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Avatar URL/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Avatar URL/i })).not.toBeInTheDocument()
    // No image set yet, so there is nothing to remove.
    expect(screen.queryByRole('button', { name: /Remove image/ })).not.toBeInTheDocument()
  })

  it('has no Save button and saves a renamed agent after a pause with its revision', async () => {
    updateIdentity.mockResolvedValue({
      config: { ...config, identity: { ...config.identity, name: 'Mallard' } },
      revision: 4,
    })
    renderCard()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' Mallard ' } })
    expect(updateIdentity).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    await waitFor(
      () =>
        expect(updateIdentity).toHaveBeenCalledWith({
          data: {
            expectedRevision: 3,
            identity: { name: 'Mallard', avatarUrl: null },
          },
        }),
      slow
    )
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(updateIdentity).toHaveBeenCalledTimes(1)
  })

  it('keeps the space typed after a name while the name is saved, so two words can be typed', async () => {
    let release: (value: unknown) => void = () => {}
    updateIdentity.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    renderCard()
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Mallard ' } })
    await waitFor(() => expect(updateIdentity).toHaveBeenCalledTimes(1), slow)
    expect(updateIdentity.mock.calls[0]![0].data.identity.name).toBe('Mallard')
    await act(async () => release(savedName('Mallard', 4)))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(name).toHaveValue('Mallard ')
    fireEvent.change(name, { target: { value: 'Mallard Duck' } })
    await waitFor(() => expect(updateIdentity).toHaveBeenCalledTimes(2), slow)
    await act(async () => release(savedName('Mallard Duck', 5)))
    expect(name).toHaveValue('Mallard Duck')
  })

  it('takes a rename made in another session only while the name is not being edited', async () => {
    renderCard()
    const name = await screen.findByLabelText('Name')
    fireEvent.focus(name)
    act(() => {
      queryClient.setQueryData(assistantKeys.settings(), {
        ...savedName('Drake', 4),
        managedFieldPaths: [],
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(name).toHaveValue('Quinn')
    fireEvent.blur(name)
    await waitFor(() => expect(name).toHaveValue('Drake'))
    expect(updateIdentity).not.toHaveBeenCalled()
  })

  it('reports an unsaved rename, including one being saved, so leaving the page is guarded', async () => {
    let release: (value: unknown) => void = () => {}
    updateIdentity.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    renderCard()
    const name = await screen.findByLabelText('Name')
    expect(screen.getByLabelText('dirty')).toHaveTextContent('Clean')
    fireEvent.change(name, { target: { value: 'Mallard' } })
    expect(screen.getByLabelText('dirty')).toHaveTextContent('Unsaved: basics')
    await waitFor(() => expect(updateIdentity).toHaveBeenCalledTimes(1), slow)
    expect(screen.getByLabelText('dirty')).toHaveTextContent('Unsaved: basics')
    await act(async () => release(savedName('Mallard', 4)))
    await waitFor(() => expect(screen.getByLabelText('dirty')).toHaveTextContent('Clean'))
  })

  it('does not save an empty name and explains why', async () => {
    renderCard()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '   ' } })
    expect(await screen.findByText('Enter a name for your AI agent.')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(updateIdentity).not.toHaveBeenCalled()
  })

  it('shows one failure toast and keeps the typed name', async () => {
    updateIdentity.mockRejectedValue(new Error('boom'))
    renderCard()
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Mallard' } })
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1), slow)
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    expect(name).toHaveValue('Mallard')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(updateIdentity).toHaveBeenCalledTimes(1)
  })

  it('surfaces a conflict without overwriting and reloads the latest identity', async () => {
    // A failing server function reaches the client as a plain Error with the server's message.
    updateIdentity.mockRejectedValue(new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE))
    renderCard()
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Mallard' } })
    const alert = await screen.findByRole('alert', {}, slow)
    expect(alert).toHaveTextContent(/changed in another session/)
    expect(toastError).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest settings' }))
    await waitFor(() => expect(name).toHaveValue('Quinn'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(updateIdentity).toHaveBeenCalledTimes(1)
  })

  it('shows Remove image only with an image, and removing it saves at once', async () => {
    const withImage = {
      ...config,
      identity: { name: 'Quinn', avatarUrl: 'https://cdn.test/q.png' },
    }
    vi.mocked(getAssistantSettingsFn).mockResolvedValue({
      config: withImage,
      revision: 3,
      managedFieldPaths: [],
    } as never)
    updateIdentity.mockResolvedValue({ config, revision: 4 })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: /Remove image/ }))
    await waitFor(() =>
      expect(updateIdentity).toHaveBeenCalledWith({
        data: { expectedRevision: 3, identity: { name: 'Quinn', avatarUrl: null } },
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Remove image/ })).not.toBeInTheDocument()
    )
  })
})
