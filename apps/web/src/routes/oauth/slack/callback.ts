import { createFileRoute } from '@tanstack/react-router'
import { exchangeSlackCode } from '@/lib/server/events/integrations/slack/oauth'
import { verifyOAuthState } from '@/lib/server/auth/oauth-state'
import {
  STATE_EXPIRY_MS,
  isSecureRequest,
  getStateCookieName,
  buildCallbackUri,
  parseCookies,
  redirectResponse,
  clearCookie,
  isValidTenantDomain,
} from '@/lib/server/domains/integrations/oauth'
import { saveIntegration } from '@/lib/server/domains/integrations/slack'
import type { SlackOAuthState } from '@/lib/server/functions/integrations'

const FALLBACK_URL = 'https://quackback.io'
const SETTINGS_PATH = '/admin/settings/integrations/slack'

function buildSettingsUrl(baseUrl: string, status: 'error' | 'connected', reason?: string): string {
  const params = new URLSearchParams({ slack: status, ...(reason && { reason }) })
  return `${baseUrl}${SETTINGS_PATH}?${params}`
}

export const Route = createFileRoute('/oauth/slack/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const slackError = url.searchParams.get('error')

        const stateData = verifyOAuthState<SlackOAuthState>(state || '')
        if (!stateData || stateData.type !== 'slack_oauth') {
          return redirectResponse(buildSettingsUrl(FALLBACK_URL, 'error', 'invalid_state'))
        }

        if (Date.now() - stateData.ts > STATE_EXPIRY_MS) {
          return redirectResponse(buildSettingsUrl(FALLBACK_URL, 'error', 'state_expired'))
        }

        const { returnDomain, workspaceId, workspaceSlug, memberId } = stateData
        const tenantUrl = `https://${returnDomain}`

        if (!isValidTenantDomain(returnDomain)) {
          return redirectResponse(buildSettingsUrl(FALLBACK_URL, 'error', 'invalid_tenant'))
        }

        if (slackError) {
          return redirectResponse(buildSettingsUrl(tenantUrl, 'error', 'slack_denied'))
        }

        if (!code) {
          return redirectResponse(buildSettingsUrl(tenantUrl, 'error', 'invalid_request'))
        }

        const cookieName = getStateCookieName('slack', request)
        const cookies = parseCookies(request.headers.get('cookie') || '')
        if (cookies[cookieName] !== state) {
          return redirectResponse(buildSettingsUrl(tenantUrl, 'error', 'state_mismatch'))
        }

        try {
          const callbackUri = buildCallbackUri('slack', request)
          const { accessToken, teamId, teamName } = await exchangeSlackCode(code, callbackUri)

          await saveIntegration({
            workspaceSlug,
            workspaceId,
            memberId,
            accessToken,
            teamId,
            teamName,
          })

          const successUrl = buildSettingsUrl(tenantUrl, 'connected')
          return redirectResponse(successUrl, [clearCookie(cookieName, isSecureRequest(request))])
        } catch (err) {
          console.error('[slack] Exchange error:', err)
          return redirectResponse(buildSettingsUrl(tenantUrl, 'error', 'exchange_failed'))
        }
      },
    },
  },
})
