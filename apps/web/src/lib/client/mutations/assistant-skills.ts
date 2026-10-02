import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createSkillFn,
  deleteSkillFn,
  updateSkillFn,
} from '@/lib/server/functions/assistant-skills'
import type { SkillInput } from '@/lib/shared/assistant/skills'
import { AUTOSAVE } from '@/lib/client/autosave'
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

/** `autosave` is for a save fired by a control on change, with no Save button. */
export function useUpdateSkill({ autosave = false }: { autosave?: boolean } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SkillInput & { id: string }) => updateSkillFn({ data: input }),
    meta: autosave ? AUTOSAVE : undefined,
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
