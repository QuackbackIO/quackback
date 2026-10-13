import { queryOptions } from '@tanstack/react-query'
import { getSupportAgentConfigFn, getAnsweringFn } from '@/lib/server/functions/support-agents'
export const supportAgentQueries = {
  config: () =>
    queryOptions({
      queryKey: ['support-agent', 'config'],
      queryFn: () => getSupportAgentConfigFn(),
      staleTime: 30_000,
    }),
  answering: () =>
    queryOptions({
      queryKey: ['support-agent', 'answering'],
      queryFn: () => getAnsweringFn(),
      staleTime: 30_000,
    }),
}
