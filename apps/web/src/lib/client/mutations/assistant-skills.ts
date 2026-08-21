import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createSkillFn,
  deleteSkillFn,
  updateSkillFn,
} from '@/lib/server/functions/assistant-skills'
import type { SkillInput } from '@/lib/shared/assistant/skills'
import { skillKeys } from '@/lib/client/queries/assistant-skills'

export function useCreateSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SkillInput) => createSkillFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillKeys.all() })
    },
  })
}

export function useUpdateSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SkillInput & { id: string }) => updateSkillFn({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillKeys.all() })
    },
  })
}

export function useDeleteSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSkillFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillKeys.all() })
    },
  })
}
