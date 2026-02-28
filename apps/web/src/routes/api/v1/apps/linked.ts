import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import {
  corsHeaders,
  preflightResponse,
} from '@/lib/server/integrations/apps/cors'

export const Route = createFileRoute('/api/v1/apps/linked')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const url = new URL(request.url)
          const integrationType = url.searchParams.get('integrationType')
          const externalId = url.searchParams.get('externalId')

          if (!integrationType || !externalId) {
            return badRequestResponse('integrationType and externalId are required')
          }

          const { getLinkedPosts } = await import(
            '@/lib/server/integrations/apps/service'
          )

          const posts = await getLinkedPosts({ integrationType, externalId })

          return new Response(JSON.stringify({ data: { posts } }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
