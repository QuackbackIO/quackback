import { createFileRoute } from '@tanstack/react-router'
import { getStatusComponentHandler, patchStatusComponentHandler } from '../-service-handlers'

// Current public path (see STATUS-ADMIN-REDESIGN-SPEC.md §4 Phase 6): the
// workspace's public wording is "service", aliasing the legacy
// `/status/components/:componentId` path. `serviceId` maps to the same
// status-component TypeID; delegates to the same handlers so the two
// families stay byte-identical.
export const Route = createFileRoute('/api/v1/status/services/$serviceId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/services/:serviceId
       */
      GET: async ({ request, params }) =>
        getStatusComponentHandler({ request, id: params.serviceId }),

      /**
       * PATCH /api/v1/status/services/:serviceId
       */
      PATCH: async ({ request, params }) =>
        patchStatusComponentHandler({ request, id: params.serviceId }),
    },
  },
})
