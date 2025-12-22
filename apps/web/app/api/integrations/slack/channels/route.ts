/**
 * Slack Channels List Route
 *
 * Lists available Slack channels for the connected workspace.
 * Requires admin/owner role.
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { db, member, integrations, decryptToken, eq } from '@/lib/db'
import { listSlackChannels } from '@quackback/integrations'

export async function GET() {
  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Get the Slack integration
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, 'slack'),
  })

  if (!integration || integration.status !== 'active') {
    return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
  }

  if (!integration.accessTokenEncrypted) {
    return NextResponse.json({ error: 'Slack token missing' }, { status: 500 })
  }

  try {
    // Decrypt token and fetch channels (pass empty string for single-tenant)
    const accessToken = decryptToken(integration.accessTokenEncrypted, '')
    const channels = await listSlackChannels(accessToken)

    return NextResponse.json({ channels })
  } catch (err) {
    console.error(
      '[Slack Channels] Error fetching channels:',
      err instanceof Error ? err.message : err
    )
    console.error('[Slack Channels] Stack:', err instanceof Error ? err.stack : '')
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
  }
}
