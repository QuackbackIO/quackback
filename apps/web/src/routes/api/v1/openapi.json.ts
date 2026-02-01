import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/openapi/json')({
  server: {
    handlers: {
      /**
       * GET /api/v1/openapi/json
       * Returns the OpenAPI 3.1 specification for the Quackback API.
       *
       * This endpoint is public and does not require authentication.
       */
      GET: async () => {
        const { generateOpenAPISpec } = await import('@/lib/server/domains/api/openapi')

        // Import all schema registrations
        await import('@/lib/server/domains/api/schemas')

        const spec = generateOpenAPISpec()

        return Response.json(spec, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          },
        })
      },
    },
  },
})
