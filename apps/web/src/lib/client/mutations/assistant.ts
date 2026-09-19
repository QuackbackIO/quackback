/** Revision-aware AI agent configuration and guidance mutations. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AssistantGuidanceRuleId } from '@quackback/ids'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'
import {
  createGuidanceRuleFn,
  updateGuidanceRuleFn,
  deleteGuidanceRuleFn,
  reorderGuidanceRulesFn,
} from '@/lib/server/functions/assistant-guidance'
import {
  updateAssistantToolRulesFn,
  getAssistantSettingsFn,
  updateAssistantIdentityFn,
  updateAssistantVoiceFn,
  updateAssistantAgentKnowledgeFn,
  updateAssistantCopilotKnowledgeFn,
  updateAssistantCopilotCapabilitiesFn,
  updateWidgetAssistantDeploymentFn,
} from '@/lib/server/functions/assistant-settings'
import {
  saveGuidanceEntryFn,
  deleteGuidanceEntryFn,
} from '@/lib/server/functions/assistant-guidance-entries'
import type { GuidanceEntrySaveInput } from '@/lib/shared/assistant/guidance-entry'
import {
  publishAssistantReleaseFn,
  rollbackAssistantReleaseFn,
  runAssistantCandidateSandboxFn,
  runAssistantReleaseCheckFn,
  setAssistantReleaseManagementFn,
} from '@/lib/server/functions/assistant-releases'
import type { ReleaseCheckKey } from '@/lib/shared/assistant/release'
import { assistantKeys } from '@/lib/client/queries/assistant'
import { settingsQueries } from '@/lib/client/queries/settings'

export interface GuidanceRuleInput {
  name: string
  appliesWhen: string | null
  instruction: string
  agent: AssistantAgentKind
  enabled: boolean
  priority: number
}

type AssistantSettings = Awaited<ReturnType<typeof getAssistantSettingsFn>>
type AssistantConfigResult = Pick<AssistantSettings, 'config' | 'revision'>

function setAssistantConfig(
  queryClient: ReturnType<typeof useQueryClient>,
  result: AssistantConfigResult
) {
  queryClient.setQueryData<AssistantSettings>(assistantKeys.settings(), (current) =>
    current ? { ...current, ...result } : current
  )
}

/**
 * One save for the entry and every role it applies to.
 *
 * The server writes both in one transaction, so the mutation has nothing to
 * sequence and a refused save leaves the editor's draft untouched.
 */
export function useSaveGuidanceEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GuidanceEntrySaveInput) => saveGuidanceEntryFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceEntries() })
    },
  })
}

export function useDeleteGuidanceEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteGuidanceEntryFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceEntries() })
    },
  })
}

export function useCreateGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GuidanceRuleInput) => createGuidanceRuleFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() })
    },
  })
}

export function useUpdateGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<GuidanceRuleInput> & { id: AssistantGuidanceRuleId }) =>
      updateGuidanceRuleFn({ data: { id, ...input } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() })
    },
  })
}

export function useDeleteGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: AssistantGuidanceRuleId) => deleteGuidanceRuleFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() })
    },
  })
}

export function useReorderGuidanceRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: AssistantGuidanceRuleId[]) => reorderGuidanceRulesFn({ data: { ids } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() })
    },
  })
}

export function useUpdateAssistantIdentity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantIdentityFn>[0]['data']) =>
      updateAssistantIdentityFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateAssistantVoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantVoiceFn>[0]['data']) =>
      updateAssistantVoiceFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateAssistantAgentKnowledge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantAgentKnowledgeFn>[0]['data']) =>
      updateAssistantAgentKnowledgeFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateAssistantToolRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantToolRulesFn>[0]['data']) =>
      updateAssistantToolRulesFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateAssistantCopilotKnowledge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantCopilotKnowledgeFn>[0]['data']) =>
      updateAssistantCopilotKnowledgeFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateAssistantCopilotCapabilities() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantCopilotCapabilitiesFn>[0]['data']) =>
      updateAssistantCopilotCapabilitiesFn({ data }),
    onSuccess: (result) => setAssistantConfig(queryClient, result),
  })
}

export function useUpdateWidgetAssistantDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateWidgetAssistantDeploymentFn>[0]['data']) =>
      updateWidgetAssistantDeploymentFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQueries.widgetConfig().queryKey })
    },
  })
}

/**
 * Release actions (QUINN-PRODUCT P7). Each one returns fresh release state or
 * a refusal carrying the version that moved, so nothing is written
 * optimistically: a publication is not a draft interaction.
 */
export function useRunAssistantReleaseCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { checkKey: ReleaseCheckKey }) => runAssistantReleaseCheckFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.releaseState() })
    },
  })
}

export function usePublishAssistantRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { expectedCandidateHash: string; note?: string }) =>
      publishAssistantReleaseFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.releaseState() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.settings() })
    },
  })
}

export function useRollbackAssistantRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { releaseId: string; expectedLiveReleaseId: string | null }) =>
      rollbackAssistantReleaseFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.releaseState() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.settings() })
    },
  })
}

export function useSetAssistantReleaseManagement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { enabled: boolean }) => setAssistantReleaseManagementFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.releaseState() })
    },
  })
}

export function useRunAssistantSandboxTurn() {
  return useMutation({
    mutationFn: (data: {
      messages: Array<{ sender: 'customer' | 'assistant'; content: string }>
      target: 'candidate' | 'live'
    }) => runAssistantCandidateSandboxFn({ data }),
  })
}
