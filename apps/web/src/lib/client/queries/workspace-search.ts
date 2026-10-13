import { queryOptions } from '@tanstack/react-query'
import { searchWorkspaceEntitiesFn } from '@/lib/server/functions/workspace-search'

export const workspaceSearchQuery = (
  principalId: string | undefined,
  query: string,
  mode: 'keyword' | 'semantic',
  limit = 10
) =>
  queryOptions({
    queryKey: ['admin', 'workspace-search', principalId, query, mode, limit],
    queryFn: ({ signal }) => searchWorkspaceEntitiesFn({ data: { query, mode, limit }, signal }),
    staleTime: 30_000,
  })
