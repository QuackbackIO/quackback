import { createFileRoute } from '@tanstack/react-router'
import { listStatusComponentsHandler, createStatusComponentHandler } from '../-service-handlers'

// Legacy path — kept byte-identical for existing consumers. The current
// public name is "service"; see `../services/index.ts` and OpenAPI's
// `deprecated: true` on `/status/components*` (status.ts).
export const Route = createFileRoute('/api/v1/status/components/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/components
       */
      GET: async ({ request }) => listStatusComponentsHandler({ request }),

      /**
       * POST /api/v1/status/components
       */
      POST: async ({ request }) => createStatusComponentHandler({ request }),
    },
  },
})
