import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isRevisionConflict } from '@/lib/client/autosave'
import { assistantQueries } from '@/lib/client/queries/assistant'
import type { getAssistantSettingsFn } from '@/lib/server/functions/assistant-settings'

type AssistantSettings = Awaited<ReturnType<typeof getAssistantSettingsFn>>

/**
 * Every save to the shared assistant configuration runs through this one
 * queue, so each save reads the revision the previous save produced instead of
 * racing it.
 */
let tail: Promise<unknown> = Promise.resolve()

export function enqueueAssistantSave<T>(run: () => Promise<T>): Promise<T> {
  const next = tail.then(run, run)
  tail = next.catch(() => {})
  return next
}

/**
 * Runs `save` in the queue with the latest settings the client knows, so it
 * sends the current revision and builds its change on the current config. A
 * revision conflict refetches the settings, so the next attempt can succeed.
 */
export function useAssistantSave() {
  const queryClient = useQueryClient()
  return useCallback(
    <T>(save: (latest: AssistantSettings) => Promise<T>): Promise<T> =>
      enqueueAssistantSave(async () => {
        const latest =
          queryClient.getQueryData(assistantQueries.settings().queryKey) ??
          (await queryClient.fetchQuery(assistantQueries.settings()))
        try {
          return await save(latest)
        } catch (error) {
          if (isRevisionConflict(error)) {
            void queryClient.invalidateQueries({ queryKey: assistantQueries.settings().queryKey })
          }
          throw error
        }
      }),
    [queryClient]
  )
}
