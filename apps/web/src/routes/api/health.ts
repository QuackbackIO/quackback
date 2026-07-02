import { createFileRoute } from '@tanstack/react-router'
import { handleLivenessProbe } from './health.live'

// Legacy probe path; /api/health/live is the canonical liveness endpoint.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => handleLivenessProbe(),
    },
  },
})
