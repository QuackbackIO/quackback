/** Assistant customization mutations: guidance-rule CRUD/reorder, tool controls, and surface instructions. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AssistantGuidanceRuleId } from '@quackback/ids'
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import {
  createGuidanceRuleFn,
  updateGuidanceRuleFn,
  deleteGuidanceRuleFn,
  reorderGuidanceRulesFn,
} from '@/lib/server/functions/assistant-guidance'
import {
  updateAssistantToolControlsFn,
  updateAssistantSurfacesFn,
} from '@/lib/server/functions/assistant-settings'
import { assistantKeys } from '@/lib/client/queries/assistant'

export interface GuidanceRuleInput {
  title: string
  body: string
  enabled?: boolean
  /** Empty/omitted = every surface. */
  surfaces?: AssistantSurface[] | null
}

export function useCreateGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GuidanceRuleInput) => createGuidanceRuleFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() }),
  })
}

export function useUpdateGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<GuidanceRuleInput> & { id: AssistantGuidanceRuleId }) =>
      updateGuidanceRuleFn({ data: { id, ...input } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() }),
  })
}

export function useDeleteGuidanceRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: AssistantGuidanceRuleId) => deleteGuidanceRuleFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() }),
  })
}

export function useReorderGuidanceRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: AssistantGuidanceRuleId[]) => reorderGuidanceRulesFn({ data: { ids } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.guidanceRules() }),
  })
}

export function useUpdateAssistantToolControls() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantToolControlsFn>[0]['data']) =>
      updateAssistantToolControlsFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.settings() }),
  })
}

export function useUpdateAssistantSurfaces() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantSurfacesFn>[0]['data']) =>
      updateAssistantSurfacesFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.settings() }),
  })
}
