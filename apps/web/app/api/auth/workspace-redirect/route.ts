import { NextRequest, NextResponse } from 'next/server'
import {
  db,
  verification,
  user,
  member,
  organization,
  workspaceDomain,
  sessionTransferToken,
  eq,
  and,
  gt,
} from '@quackback/db'
import { headers } from 'next/headers'

/**
 * POST /api/auth/workspace-redirect
 *
 * Create a session transfer token and return redirect URL for a workspace.
 * Used after email verification in the workspace finder flow.
 *
 * Requires a verifiedEmailToken (from the verify-signin-code step) to prevent
 * bypassing email verification.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { verifiedEmailToken, workspaceId } = body

    if (!verifiedEmailToken || typeof verifiedEmailToken !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (!workspaceId || typeof workspaceId !== 'string') {
      return NextResponse.json({ error: 'Workspace is required' }, { status: 400 })
    }

    // Verify the email token
    const verifiedEmailRecord = await db.query.verification.findFirst({
      where: and(
        eq(verification.identifier, `verified-email:${verifiedEmailToken}`),
        gt(verification.expiresAt, new Date())
      ),
    })

    if (!verifiedEmailRecord) {
      return NextResponse.json({ error: 'Session expired. Please try again.' }, { status: 400 })
    }

    const email = verifiedEmailRecord.value

    // Delete the verified email token (one-time use)
    await db.delete(verification).where(eq(verification.id, verifiedEmailRecord.id))

    // Find the user in this workspace
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, workspaceId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Find user with this email in this org
    const userRecord = await db.query.user.findFirst({
      where: and(eq(user.email, email), eq(user.organizationId, org.id)),
    })

    if (!userRecord) {
      return NextResponse.json(
        { error: 'You do not have an account in this workspace' },
        { status: 403 }
      )
    }

    // Get user's member record to determine role/context
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, userRecord.id), eq(member.organizationId, org.id)),
    })

    // Get workspace domain
    const domain = await db.query.workspaceDomain.findFirst({
      where: and(eq(workspaceDomain.organizationId, org.id), eq(workspaceDomain.isPrimary, true)),
    })

    if (!domain) {
      return NextResponse.json({ error: 'Workspace domain not configured' }, { status: 500 })
    }

    // Determine context based on role
    const isTeamMember = memberRecord && ['owner', 'admin', 'member'].includes(memberRecord.role)
    const context = isTeamMember ? 'team' : 'portal'
    const callbackUrl = isTeamMember ? '/admin' : '/'

    // Generate session transfer token
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 60 * 1000) // 1 minute

    await db.insert(sessionTransferToken).values({
      id: crypto.randomUUID(),
      token,
      userId: userRecord.id,
      targetDomain: domain.domain,
      callbackUrl,
      context,
      expiresAt,
    })

    // Build redirect URL
    const headersList = await headers()
    const protocol = headersList.get('x-forwarded-proto') || 'http'
    const redirectUrl = `${protocol}://${domain.domain}/api/auth/trust-login?token=${token}`

    return NextResponse.json({ redirectUrl })
  } catch (error) {
    console.error('Error in workspace-redirect:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
