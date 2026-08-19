import { createFileRoute } from '@tanstack/react-router'

/** Legacy V1 entry point. Preserve no V1 event or payload contract. */
export function handleSandbox({ request }: { request: Request }): Response {
  return Response.redirect(new URL('/api/admin/assistant/test', request.url), 308)
}

export const Route = createFileRoute('/api/admin/assistant/sandbox')({
  server: {
    handlers: {
      POST: handleSandbox,
    },
  },
})
