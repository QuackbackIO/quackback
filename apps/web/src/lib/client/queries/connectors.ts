import { queryOptions } from '@tanstack/react-query'
import { fetchDataConnectorsFn } from '@/lib/server/functions/data-connectors'

/** Query keys for the Data connectors admin UI (AI & Automation). */
export const connectorKeys = {
  all: () => ['connectors'] as const,
}

/** Every connector, newest first (the Data connectors list). */
export const connectorsQuery = () =>
  queryOptions({
    queryKey: connectorKeys.all(),
    queryFn: async () => (await fetchDataConnectorsFn()).connectors,
    staleTime: 60 * 1000,
  })
