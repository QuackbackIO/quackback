import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { DefaultErrorPage, NotFoundPage } from '@/components/shared/error-page'
import { RoutePendingComponent } from '@/components/shared/route-pending'
import { expireRouteContextOnInvalidate } from '@/lib/client/route-context-memo'

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
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000,
    scrollRestoration: true,
    defaultPendingMs: 300,
    defaultPendingMinMs: 200,
    defaultPendingComponent: RoutePendingComponent,
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

  // Sign-in, sign-out and settings changes call router.invalidate() to
  // refresh the root and admin context, which navigations otherwise reuse.
  expireRouteContextOnInvalidate(router)

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
