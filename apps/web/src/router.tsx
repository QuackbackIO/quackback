import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { DefaultErrorPage, NotFoundPage } from '@/components/shared/error-page'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
      },
    },
  })

  const router = createRouter({
    routeTree,
    defaultPreload: false,
    scrollRestoration: true,
    defaultPendingMs: 1000,
    defaultPendingMinMs: 0,
    context: {
      queryClient,
    },
    defaultErrorComponent: DefaultErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  return router
}
