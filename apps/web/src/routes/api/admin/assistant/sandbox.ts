import { createFileRoute } from '@tanstack/react-router'

/** Legacy V1 entry point. The admin sandbox is gone. */
export function handleSandbox(): Response {
  return new Response(null, { status: 410 })
}

export const Route = createFileRoute('/api/admin/assistant/sandbox')({
  server: {
    handlers: {
      POST: handleSandbox,
    },
  },
})
