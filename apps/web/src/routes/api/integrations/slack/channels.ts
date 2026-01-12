import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'

export const Route = createFileRoute('/api/integrations/slack/channels')({
  server: {
    handlers: {
      /**
       * GET /api/integrations/slack/channels
       * Lists available Slack channels for the connected workspace
       */
      GET: async () => {
        const { getSession } = await import('@/lib/server-functions/auth')
        const { db, member, integrations, decryptToken, eq } = await import('@/lib/db')
        const { listSlackChannels } = await import('@quackback/integrations')

        console.log(`[slack] Fetching channels`)

        // Validate session
        const session = await getSession()
        if (!session?.user) {
          console.warn(`[slack] ⚠️ Unauthorized channel fetch`)
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check user has admin role
        const memberRecord = await db.query.member.findFirst({
          where: eq(member.userId, session.user.id as UserId),
        })

        if (!memberRecord || memberRecord.role !== 'admin') {
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

        // Get workspace ID for decryption salt
        const settingsRecord = await db.query.settings.findFirst({
          columns: { id: true },
        })

        if (!settingsRecord) {
          return Response.json({ error: 'Workspace not configured' }, { status: 500 })
        }

        try {
          // Decrypt token using workspace ID as salt (consistent with integration-service.ts)
          const accessToken = decryptToken(integration.accessTokenEncrypted, settingsRecord.id)
          const channels = await listSlackChannels(accessToken)

          console.log(`[slack] ✅ Channels fetched: ${channels.length} channels`)
          return Response.json({ channels })
        } catch (err) {
          console.error(
            `[slack] ❌ Channel fetch failed:`,
            err instanceof Error ? err.message : err
          )
          return Response.json({ error: 'Failed to fetch channels' }, { status: 500 })
        }
      },
    },
  },
})
