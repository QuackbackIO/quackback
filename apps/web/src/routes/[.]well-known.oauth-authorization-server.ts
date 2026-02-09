/**
 * OAuth Authorization Server Metadata (RFC 8414)
 *
 * GET /.well-known/oauth-authorization-server
 *
 * Returns authorization server metadata (endpoints, scopes, etc.)
 * for OAuth 2.1 discovery. The oauth-provider plugin marks these
 * as SERVER_ONLY, so we serve them manually via the exported helper.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderAuthServerMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        const handler = oauthProviderAuthServerMetadata(auth)
        return handler(request)
      },
    },
  },
})
