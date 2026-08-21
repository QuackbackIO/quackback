import { queryOptions } from '@tanstack/react-query'
import { getConnectorFn, listConnectorsFn } from '@/lib/server/functions/assistant-connectors'

const STALE_TIME = 30 * 1000

export const connectorKeys = {
  all: () => ['assistant', 'connectors'] as const,
  detail: (id: string) => ['assistant', 'connectors', id] as const,
}

export const connectorQueries = {
  list: () =>
    queryOptions({
      queryKey: connectorKeys.all(),
      queryFn: listConnectorsFn,
      staleTime: STALE_TIME,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: connectorKeys.detail(id),
      queryFn: () => getConnectorFn({ data: { id } }),
      staleTime: STALE_TIME,
    }),
}
