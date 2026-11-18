/**
 * Portal sections on their own hostnames: the framework binding. The routing
 * itself is section-host-handler.ts, behind a dynamic import because
 * `start.ts` is a client entry as well as a server one, and the handler
 * reaches the database.
 */
import { createMiddleware } from '@tanstack/react-start'

export const sectionHostMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { handleSectionHost } = await import('./section-host-handler')
  return handleSectionHost({
    request,
    next: (opts) => Promise.resolve(opts ? next(opts) : next()),
  })
})
