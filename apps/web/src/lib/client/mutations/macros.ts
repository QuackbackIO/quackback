/** Macro CRUD mutations for the admin manager; each invalidates every list. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MacroId } from '@quackback/ids'
import type { MacroAction, MacroScope } from '@/lib/shared/db-types'
import { createMacroFn, updateMacroFn, deleteMacroFn } from '@/lib/server/functions/macros'
import { macroKeys } from '@/lib/client/queries/macros'

export interface MacroInput {
  name: string
  body: string
  scope: MacroScope
  actions: MacroAction[]
}

export function useCreateMacro() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MacroInput) => createMacroFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: macroKeys.all() }),
  })
}

export function useUpdateMacro() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: MacroInput & { id: MacroId }) =>
      updateMacroFn({ data: { id, ...input } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: macroKeys.all() }),
  })
}

export function useDeleteMacro() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: MacroId) => deleteMacroFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: macroKeys.all() }),
  })
}
