/**
 * OpenID Connect Discovery (RFC 8414 / OIDC Discovery 1.0)
 *
 * GET /.well-known/openid-configuration
 *
 * Returns OpenID Connect provider metadata. The oauth-provider plugin
 * marks these as SERVER_ONLY, so we serve them manually via the exported helper.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/.well-known/openid-configuration')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderOpenIdConfigMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        const handler = oauthProviderOpenIdConfigMetadata(auth)
        return handler(request)
      },
    },
  },
})
