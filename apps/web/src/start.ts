/**
 * TanStack Start global configuration entry.
 *
 * Registers global request middleware that runs for every server request
 * (SSR, server routes, server functions). The request-context middleware opens
 * the per-request structured-logging scope; keep it first so everything
 * downstream logs with request_id/route attached.
 */
import { createStart } from '@tanstack/react-start'
import { requestContextMiddleware } from '@/lib/server/middleware/request-context'

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [requestContextMiddleware],
  }
})
