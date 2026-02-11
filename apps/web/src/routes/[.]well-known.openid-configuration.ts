/**
 * OpenID Connect Discovery (RFC 8414 / OIDC Discovery 1.0)
 *
 * GET /.well-known/openid-configuration
 *
 * Returns OpenID Connect provider metadata. The oauth-provider plugin
 * marks these as SERVER_ONLY, so we serve them manually via the exported helper.
 */

import { createFileRoute } from '@tanstack/react-router'

/** Structural type matching what oauthProviderOpenIdConfigMetadata expects from the auth instance */
interface AuthWithOpenIdConfig {
  api: { getOpenIdConfig: (...args: never[]) => unknown }
}

export const Route = createFileRoute('/.well-known/openid-configuration')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderOpenIdConfigMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        // Plugin-added API methods aren't visible in the static type from getAuth()
        const handler = oauthProviderOpenIdConfigMetadata(auth as unknown as AuthWithOpenIdConfig)
        return handler(request)
      },
    },
  },
})
