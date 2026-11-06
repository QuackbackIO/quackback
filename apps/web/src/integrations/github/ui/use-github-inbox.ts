/** Autosaving switches for the GitHub inbox channel and its repositories. */
import type { GitHubInboundSetting } from '@/integrations/github/ui/github-inbound-mode'
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

/** What one repository's issues open in the inbox: nothing, conversations, or tickets. */
export function useSetGitHubRepositoryInbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { destinationId: string } & GitHubInboundSetting) =>
      setGitHubRepositoryInboxFn({ data: input }),
    meta: { ...AUTOSAVE, showServerMessage: true },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: githubChannelStatusQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] }),
      ]),
  })
}
