import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { DefaultErrorPage, NotFoundPage } from '@/components/shared/error-page'
import { RoutePendingComponent } from '@/components/shared/route-pending'
import { expireRouteContextOnInvalidate } from '@/lib/client/route-context-memo'

// The small client helpers that lazily loaded chunks share. Reachable from
// here, they join the entry chunk's static closure (see the `$initial` group
// in vite.config.ts) instead of each becoming a chunk, and a request, of its
// own wherever two lazy chunks import it.
export { useOpenedOnce } from '@/lib/client/hooks/use-opened-once'
export { lazyWithPreload } from '@/lib/client/lazy-with-preload'
export { createValueStore, useStoreValue, useDebouncedStoreValue } from '@/lib/client/value-store'

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
