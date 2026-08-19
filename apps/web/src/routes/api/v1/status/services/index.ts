import { createFileRoute } from '@tanstack/react-router'
import { listStatusComponentsHandler, createStatusComponentHandler } from '../-service-handlers'

// Current public path (see STATUS-ADMIN-REDESIGN-SPEC.md §4 Phase 6): the
// workspace's public wording is "service", aliasing the legacy
// `/status/components` path. Delegates to the same handlers so the two
// families stay byte-identical.
export const Route = createFileRoute('/api/v1/status/services/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/services
       */
      GET: async ({ request }) => listStatusComponentsHandler({ request }),

      /**
       * POST /api/v1/status/services
       */
      POST: async ({ request }) => createStatusComponentHandler({ request }),
    },
  },
})
