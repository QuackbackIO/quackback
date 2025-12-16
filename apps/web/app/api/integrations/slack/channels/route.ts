/**
 * Slack Channels List Route
 *
 * Lists available Slack channels for the connected workspace.
 * Requires admin/owner role.
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { db, member, organizationIntegrations, decryptToken, eq, and } from '@/lib/db'
import { listSlackChannels } from '@quackback/integrations'
import { isValidTypeId, type OrgId } from '@quackback/ids'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orgIdParam = searchParams.get('orgId')

  if (!orgIdParam || !isValidTypeId(orgIdParam, 'org')) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  const orgId = orgIdParam as OrgId

  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role in org
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Get the Slack integration
  const integration = await db.query.organizationIntegrations.findFirst({
    where: and(
      eq(organizationIntegrations.organizationId, orgId),
      eq(organizationIntegrations.integrationType, 'slack')
    ),
  })

  if (!integration || integration.status !== 'active') {
    return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
  }

  if (!integration.accessTokenEncrypted) {
    return NextResponse.json({ error: 'Slack token missing' }, { status: 500 })
  }

  try {
    // Decrypt token and fetch channels
    const accessToken = decryptToken(integration.accessTokenEncrypted, orgId)
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
