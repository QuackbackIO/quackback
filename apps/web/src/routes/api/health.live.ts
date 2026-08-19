import { createFileRoute } from '@tanstack/react-router'

/** Liveness probe: the process is up and serving HTTP. No I/O. */
export function handleLivenessProbe(): Response {
  return Response.json({ status: 'ok' })
}

export const Route = createFileRoute('/api/health/live')({
  server: {
    handlers: {
      GET: () => handleLivenessProbe(),
    },
  },
})
