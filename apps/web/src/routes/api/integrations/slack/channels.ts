import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@/lib/auth/server'
import { db, member, integrations, decryptToken, eq } from '@/lib/db'
import { listSlackChannels } from '@quackback/integrations'
import type { UserId } from '@quackback/ids'

export const Route = createFileRoute('/api/integrations/slack/channels')({
  server: {
    handlers: {
      /**
       * GET /api/integrations/slack/channels
       * Lists available Slack channels for the connected workspace
       */
      GET: async () => {
        // Validate session
        const session = await getSession()
        if (!session?.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check user has admin/owner role
        const memberRecord = await db.query.member.findFirst({
          where: eq(member.userId, session.user.id as UserId),
        })

        if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
          return Response.json({ error: 'Forbidden - admin role required' }, { status: 403 })
        }

        // Get the Slack integration
        const integration = await db.query.integrations.findFirst({
          where: eq(integrations.integrationType, 'slack'),
        })

        if (!integration || integration.status !== 'active') {
          return Response.json({ error: 'Slack not connected' }, { status: 404 })
        }

        if (!integration.accessTokenEncrypted) {
          return Response.json({ error: 'Slack token missing' }, { status: 500 })
        }

        try {
          // Decrypt token and fetch channels (pass empty string for single workspace)
          const accessToken = decryptToken(integration.accessTokenEncrypted, '')
          const channels = await listSlackChannels(accessToken)

          return Response.json({ channels })
        } catch (err) {
          console.error(
            '[Slack Channels] Error fetching channels:',
            err instanceof Error ? err.message : err
          )
          console.error('[Slack Channels] Stack:', err instanceof Error ? err.stack : '')
          return Response.json({ error: 'Failed to fetch channels' }, { status: 500 })
        }
      },
    },
  },
})
