import { createFileRoute } from '@tanstack/react-router'
import { getSlackOAuthUrl } from '@/lib/events/integrations/slack/oauth'
import { verifyOAuthState } from '@/lib/auth/oauth-state'
import {
  STATE_EXPIRY_MS,
  isSecureRequest,
  getStateCookieName,
  buildCallbackUri,
  redirectResponse,
  createStateCookie,
} from '@/lib/integrations/oauth'
import type { SlackOAuthState } from '@/lib/server-functions/integrations'

export const Route = createFileRoute('/oauth/slack/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const state = url.searchParams.get('state')

        if (!state) {
          return Response.json({ error: 'state is required' }, { status: 400 })
        }

        const stateData = verifyOAuthState<SlackOAuthState>(state)
        if (!stateData || stateData.type !== 'slack_oauth') {
          return Response.json({ error: 'Invalid state' }, { status: 400 })
        }

        if (Date.now() - stateData.ts > STATE_EXPIRY_MS) {
          return Response.json({ error: 'State expired' }, { status: 400 })
        }

        const callbackUri = buildCallbackUri('slack', request)
        const slackAuthUrl = getSlackOAuthUrl(state, callbackUri)
        const isSecure = isSecureRequest(request)
        const cookieName = getStateCookieName('slack', request)
        const maxAgeSeconds = STATE_EXPIRY_MS / 1000

        return redirectResponse(slackAuthUrl, [
          createStateCookie(cookieName, state, isSecure, maxAgeSeconds),
        ])
      },
    },
  },
})
