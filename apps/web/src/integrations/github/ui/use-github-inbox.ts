/** Autosaving switches for the GitHub inbox channel and its repositories. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import {
  setGitHubInboxEnabledFn,
  setGitHubRepositoryInboxFn,
} from '@/integrations/github/server/functions'

export function useSetGitHubInbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => setGitHubInboxEnabledFn({ data: { enabled } }),
    // The server says what to fix ("Resume GitHub before enabling the inbox channel.").
    meta: { ...AUTOSAVE, showServerMessage: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: githubChannelStatusQuery().queryKey }),
  })
}

/** Whether one repository's issues come into the inbox. */
export function useSetGitHubRepositoryInbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { destinationId: string; enabled: boolean }) =>
      setGitHubRepositoryInboxFn({ data: input }),
    meta: { ...AUTOSAVE, showServerMessage: true },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: githubChannelStatusQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] }),
      ]),
  })
}
