// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const server = vi.hoisted(() => ({ fail: null as Error | null }))
const respond = async () => {
  if (server.fail) throw server.fail
  return { config: {}, revision: 2 }
}
vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(),
  updateAssistantToolRulesFn: respond,
  updateAssistantIdentityFn: respond,
  updateAssistantVoiceFn: respond,
  updateAssistantAgentKnowledgeFn: respond,
  updateAssistantCopilotKnowledgeFn: respond,
  updateAssistantCopilotCapabilitiesFn: respond,
  updateWidgetAssistantDeploymentFn: respond,
}))
vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  createGuidanceRuleFn: vi.fn(),
  updateGuidanceRuleFn: vi.fn(),
  deleteGuidanceRuleFn: vi.fn(),
  reorderGuidanceRulesFn: vi.fn(),
}))

const { createAutosaveMutationCache } = await import('../autosave')
const { ASSISTANT_REVISION_CONFLICT_MESSAGE } = await import('@/lib/shared/assistant/config')
const mutations = await import('../mutations/assistant')

afterEach(() => {
  server.fail = null
  toastError.mockReset()
})

function setup<T>(useHook: () => T) {
  const client = new QueryClient({ mutationCache: createAutosaveMutationCache() })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(useHook, { wrapper }) }
}

type AnyMutation = { mutateAsync: (input: never) => Promise<unknown> }

const HOOKS = {
  useUpdateAssistantIdentity: mutations.useUpdateAssistantIdentity,
  useUpdateAssistantVoice: mutations.useUpdateAssistantVoice,
  useUpdateAssistantAgentKnowledge: mutations.useUpdateAssistantAgentKnowledge,
  useUpdateAssistantToolRules: mutations.useUpdateAssistantToolRules,
  useUpdateAssistantCopilotKnowledge: mutations.useUpdateAssistantCopilotKnowledge,
  useUpdateAssistantCopilotCapabilities: mutations.useUpdateAssistantCopilotCapabilities,
  useUpdateWidgetAssistantDeployment: mutations.useUpdateWidgetAssistantDeployment,
} as const

describe('assistant settings hooks are autosaves', () => {
  it.each(Object.keys(HOOKS) as Array<keyof typeof HOOKS>)(
    '%s shows the failure toast when a save fails',
    async (name) => {
      server.fail = new Error('boom')
      const { result } = setup(() => HOOKS[name]() as unknown as AnyMutation)
      await expect(result.current.mutateAsync({} as never)).rejects.toThrow('boom')
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    }
  )

  it.each(['useUpdateAssistantIdentity', 'useUpdateAssistantVoice'] as const)(
    '%s leaves a revision conflict to the page notice',
    async (name) => {
      server.fail = new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE)
      const { result } = setup(() => HOOKS[name]() as unknown as AnyMutation)
      await expect(result.current.mutateAsync({} as never)).rejects.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(toastError).not.toHaveBeenCalled()
    }
  )

  it.each([
    'useUpdateAssistantAgentKnowledge',
    'useUpdateAssistantToolRules',
    'useUpdateAssistantCopilotCapabilities',
  ] as const)('%s toasts a revision conflict, which has no inline notice', async (name) => {
    server.fail = new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE)
    const { result } = setup(() => HOOKS[name]() as unknown as AnyMutation)
    await expect(result.current.mutateAsync({} as never)).rejects.toThrow()
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})
