import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

// Client-side singleton to prevent memory leaks
// On server (SSR), create fresh instances for each request
let clientRouterInstance: ReturnType<typeof createRouter> | undefined

export function getRouter() {
  const isServer = typeof window === 'undefined'

  // On client, use singleton to prevent memory leaks from multiple instances
  if (!isServer && clientRouterInstance) {
    return clientRouterInstance
  }

  // Create new QueryClient
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
      },
    },
  })

  // Create new router
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold">404</h1>
          <p className="mt-2 text-muted-foreground">Page not found</p>
        </div>
      </div>
    ),
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  // Cache on client only
  if (!isServer) {
    clientRouterInstance = router
  }

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
