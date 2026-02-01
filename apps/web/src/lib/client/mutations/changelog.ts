/**
 * Changelog Mutations
 *
 * Mutation hooks for changelog CRUD operations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangelogId } from '@quackback/ids'
import {
  createChangelogFn,
  updateChangelogFn,
  deleteChangelogFn,
} from '@/lib/server/functions/changelog'
import { changelogKeys } from '@/lib/client/queries/changelog'
import type { CreateChangelogInput, UpdateChangelogInput } from '@/lib/shared/schemas/changelog'

/**
 * Create a new changelog entry
 */
export function useCreateChangelog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateChangelogInput) => createChangelogFn({ data: input }),
    onSuccess: () => {
      // Invalidate all changelog lists to refetch with new entry
      queryClient.invalidateQueries({ queryKey: changelogKeys.lists() })
      // Also invalidate public lists in case it was published
      queryClient.invalidateQueries({ queryKey: changelogKeys.public() })
    },
  })
}

/**
 * Update an existing changelog entry
 */
export function useUpdateChangelog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateChangelogInput) => updateChangelogFn({ data: input }),
    onSuccess: (data) => {
      const id = data.id as ChangelogId
      // Update the detail cache with new data
      queryClient.setQueryData(changelogKeys.detail(id), data)
      // Invalidate lists in case status or title changed
      queryClient.invalidateQueries({ queryKey: changelogKeys.lists() })
      // Also invalidate public lists in case publish state changed
      queryClient.invalidateQueries({ queryKey: changelogKeys.public() })
    },
  })
}

/**
 * Delete a changelog entry
 */
export function useDeleteChangelog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: ChangelogId) => deleteChangelogFn({ data: { id } }),
    onSuccess: (_data, id) => {
      // Remove from detail cache
      queryClient.removeQueries({ queryKey: changelogKeys.detail(id) })
      // Invalidate lists to remove the deleted entry
      queryClient.invalidateQueries({ queryKey: changelogKeys.lists() })
      // Also invalidate public lists
      queryClient.invalidateQueries({ queryKey: changelogKeys.public() })
    },
  })
}
