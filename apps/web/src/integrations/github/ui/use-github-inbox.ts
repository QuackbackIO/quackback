/** Autosaving switch for the GitHub inbox channel. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import { setGitHubInboxEnabledFn } from '@/integrations/github/server/functions'

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
