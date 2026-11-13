/** Choosing the repository GitHub sync serves; its webhook moves with the selection. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import { setGitHubRepositoryFn } from '@/integrations/github/server/functions'

export function useSetGitHubRepository() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (repository: string) => setGitHubRepositoryFn({ data: { repository } }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] }),
        queryClient.invalidateQueries({ queryKey: githubChannelStatusQuery().queryKey }),
      ]),
  })
}
