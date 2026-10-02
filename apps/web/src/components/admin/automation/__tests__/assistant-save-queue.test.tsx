// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { ASSISTANT_REVISION_CONFLICT_MESSAGE } from '@/lib/shared/assistant/config'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

/** A stand-in for the server: one revision, rejecting a save that does not carry it. */
const server = vi.hoisted(() => {
  const state = {
    revision: 2,
    config: {} as Record<string, any>,
    saves: [] as string[],
    gate: null as Promise<void> | null,
    loads: 0,
  }
  return state
})

function resetServer() {
  server.revision = 2
  server.saves = []
  server.gate = null
  server.loads = 0
  server.config = {
    version: 3,
    identity: { name: 'Quinn', avatarUrl: null },
    agents: {
      agent: {
        voice: { tone: 'balanced', responseLength: 'balanced', additionalInstructions: '' },
        knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
        toolRules: {},
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
        toolRules: {},
      },
    },
  }
}

vi.mock('@/lib/server/functions/assistant-settings', () => {
  async function commit(label: string, expected: number, apply: (config: any) => void) {
    if (server.gate) await server.gate
    if (expected !== server.revision) throw new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE)
    const next = structuredClone(server.config)
    apply(next)
    server.config = next
    server.revision += 1
    server.saves.push(`${label}@${expected}`)
    return { config: structuredClone(server.config), revision: server.revision }
  }
  return {
    getAssistantSettingsFn: vi.fn(async () => {
      server.loads += 1
      return {
        config: structuredClone(server.config),
        revision: server.revision,
        managedFieldPaths: [],
      }
    }),
    updateAssistantIdentityFn: ({ data }: any) =>
      commit('identity', data.expectedRevision, (c) => (c.identity = data.identity)),
    updateAssistantVoiceFn: ({ data }: any) =>
      commit('voice', data.expectedRevision, (c) => (c.agents.agent.voice = data.voice)),
    updateAssistantAgentKnowledgeFn: ({ data }: any) =>
      commit('agentKnowledge', data.expectedRevision, (c) => {
        c.agents.agent.knowledge = data.knowledge
      }),
    updateAssistantCopilotKnowledgeFn: ({ data }: any) =>
      commit('copilotKnowledge', data.expectedRevision, (c) => {
        c.agents.copilot.knowledge = data.knowledge
      }),
    updateAssistantCopilotCapabilitiesFn: ({ data }: any) =>
      commit('capabilities', data.expectedRevision, (c) => {
        c.agents.copilot.capabilities = data.capabilities
      }),
    updateAssistantToolRulesFn: ({ data }: any) =>
      commit('toolRules', data.expectedRevision, (c) => {
        c.agents[data.agent].toolRules = data.toolRules
      }),
    updateWidgetAssistantDeploymentFn: vi.fn(),
  }
})
vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  listAssistantToolsFn: vi.fn(async () => [
    { name: 'set_attribute', label: 'Set attribute', description: 'Record.', risk: 'write' },
    { name: 'create_ticket', label: 'Create ticket', description: 'Open.', risk: 'write' },
  ]),
}))
vi.mock('@/lib/server/functions/uploads', () => ({ getAssistantAvatarUploadUrlFn: vi.fn() }))

import { AssistantIdentityCard } from '../assistant-identity-card'
import { AgentKnowledgeCard } from '../assistant-knowledge-card'
import { BuiltInToolsCard } from '../builtin-tools-card'
import { CopilotPauseControl } from '../copilot-deployment-card'

beforeEach(resetServer)
afterEach(() => {
  cleanup()
  toastError.mockReset()
})

function renderCards(node: React.ReactElement) {
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

function holdServer() {
  let open: () => void = () => {}
  server.gate = new Promise<void>((resolve) => {
    open = () => {
      server.gate = null
      resolve()
    }
  })
  return open
}

const slow = { timeout: 4000 }

describe('assistant saves share one queue', () => {
  it('sends a toggle made during a rename save against the revision that save produces', async () => {
    renderCards(
      <>
        <AssistantIdentityCard />
        <AgentKnowledgeCard />
      </>
    )
    const name = await screen.findByLabelText('Name')
    await screen.findByLabelText('Use Feedback posts')
    const open = holdServer()
    fireEvent.change(name, { target: { value: 'Mallard' } })
    // The rename save is now in flight, held by the server.
    await waitFor(() => expect(server.gate).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 1000))
    fireEvent.click(screen.getByLabelText('Use Feedback posts'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await act(async () => open())
    await waitFor(() => expect(server.saves).toHaveLength(2), slow)
    expect(server.saves).toEqual(['identity@2', 'agentKnowledge@3'])
    expect(server.config.identity.name).toBe('Mallard')
    expect(server.config.agents.agent.knowledge.posts).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('saves a name typed right after a toggle, each against the latest revision', async () => {
    renderCards(
      <>
        <AssistantIdentityCard />
        <AgentKnowledgeCard />
      </>
    )
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Mallard' } })
    fireEvent.click(await screen.findByLabelText('Use Feedback posts'))
    await waitFor(() => expect(server.saves).toHaveLength(2), slow)
    expect(server.saves).toEqual(['agentKnowledge@2', 'identity@3'])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps both built-in rules when two are picked before the first is saved', async () => {
    renderCards(<BuiltInToolsCard />)
    const first = await screen.findByRole('radiogroup', { name: 'Set attribute' })
    const second = screen.getByRole('radiogroup', { name: 'Create ticket' })
    const open = holdServer()
    await userEvent.click(within(first).getByRole('radio', { name: 'Never' }))
    await userEvent.click(within(second).getByRole('radio', { name: 'Ask' }))
    await act(async () => open())
    await waitFor(() => expect(server.saves).toHaveLength(2), slow)
    expect(server.config.agents.agent.toolRules).toEqual({
      set_attribute: 'deny',
      create_ticket: 'ask',
    })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('pauses Copilot against the revision a queued save produced', async () => {
    renderCards(
      <>
        <AssistantIdentityCard />
        <CopilotPauseControl />
      </>
    )
    const name = await screen.findByLabelText('Name')
    const pause = await screen.findByRole('button', { name: 'Pause Copilot' })
    const open = holdServer()
    fireEvent.change(name, { target: { value: 'Mallard' } })
    await waitFor(() => expect(server.gate).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 1000))
    fireEvent.click(pause)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause Copilot' }))
    await act(async () => open())
    await waitFor(() => expect(server.saves).toHaveLength(2), slow)
    expect(server.saves).toEqual(['identity@2', 'capabilities@3'])
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('a change from another session', () => {
  it('refetches after a rejected built-in rule so the same pick then succeeds', async () => {
    renderCards(<BuiltInToolsCard />)
    const tool = await screen.findByRole('radiogroup', { name: 'Set attribute' })
    // Another session saved, so the revision this page holds is stale.
    server.revision = 9
    await userEvent.click(within(tool).getByRole('radio', { name: 'Never' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(server.saves).toEqual([])
    await waitFor(() => expect(server.loads).toBeGreaterThan(1))
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Set attribute' })).getByRole('radio', {
        name: 'Never',
      })
    )
    await waitFor(() => expect(server.saves).toEqual(['toolRules@9']))
  })

  it('refetches after a rejected pause so pausing again succeeds', async () => {
    renderCards(<CopilotPauseControl />)
    const pause = await screen.findByRole('button', { name: 'Pause Copilot' })
    server.revision = 9
    fireEvent.click(pause)
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Pause Copilot' })
    )
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(server.loads).toBeGreaterThan(1))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Pause Copilot' })
    )
    await waitFor(() => expect(server.saves).toEqual(['capabilities@9']))
  })
})
