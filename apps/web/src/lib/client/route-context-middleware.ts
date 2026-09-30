import { createMiddleware } from '@tanstack/react-start'
import { expireRouteContext } from './route-context-memo'

/**
 * Global function middleware (registered in start.ts): a server function
 * called with POST changes something, so once it settles in the browser the
 * route context kept between navigations is dropped, and the next navigation
 * reads what it changed.
 */
export const expireRouteContextOnWrite = createMiddleware({ type: 'function' }).client(
  async ({ method, next }) => {
    try {
      return await next()
    } finally {
      if (method === 'POST') expireRouteContext()
    }
  }
)
