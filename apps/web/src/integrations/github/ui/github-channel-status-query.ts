import { queryOptions } from '@tanstack/react-query'
import { getGitHubChannelStatusFn } from '@/integrations/github/server/functions'

/**
 * The GitHub issues channel's connection (settings.manage), shared by the
 * Channels settings pages' loaders, which warm it into the document, and the
 * rows that read it.
 */
export const githubChannelStatusQuery = () =>
  queryOptions({
    queryKey: ['settings', 'github-channel-status'],
    queryFn: () => getGitHubChannelStatusFn(),
  })
