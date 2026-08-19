import { createFileRoute } from '@tanstack/react-router'
import { getStatusComponentHandler, patchStatusComponentHandler } from '../-service-handlers'

// Legacy path — kept byte-identical for existing consumers. The current
// public name is "service"; see `../services/$serviceId.ts` and OpenAPI's
// `deprecated: true` on `/status/components*` (status.ts).
export const Route = createFileRoute('/api/v1/status/components/$componentId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/components/:componentId
       */
      GET: async ({ request, params }) =>
        getStatusComponentHandler({ request, id: params.componentId }),

      /**
       * PATCH /api/v1/status/components/:componentId
       */
      PATCH: async ({ request, params }) =>
        patchStatusComponentHandler({ request, id: params.componentId }),
    },
  },
})
