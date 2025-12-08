import { QueryClient, isServer } from '@tanstack/react-query'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't refetch on window focus in dashboard
        refetchOnWindowFocus: false,
        // Keep data fresh for 30 seconds before considering stale
        staleTime: 30 * 1000,
        // Retry failed requests twice
        retry: 2,
        // Garbage collect unused data after 10 minutes
        gcTime: 10 * 60 * 1000,
      },
      mutations: {
        // Retry mutations once on network error
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

export function getQueryClient() {
  if (isServer) {
    // Server: always create a new query client
    return makeQueryClient()
  }
  // Browser: reuse singleton to preserve cache across navigations
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}
