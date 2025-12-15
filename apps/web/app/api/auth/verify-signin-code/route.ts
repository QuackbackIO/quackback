import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import {
  db,
  verification,
  user,
  member,
  organization,
  workspaceDomain,
  eq,
  and,
  gt,
} from '@quackback/db'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import { generateId } from '@quackback/ids'

interface WorkspaceInfo {
  id: string
  name: string
  slug: string
  domain: string
  logoUrl: string | null
  role: string
}

/**
 * POST /api/auth/verify-signin-code
 *
 * Verify a signin code and return workspaces for that email.
 * Used by the main domain workspace finder flow.
 *
 * After verification, returns all workspaces where a user with this email exists.
 * Each workspace is independent - same email can have different accounts.
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`signin-verify:${clientIp}`, rateLimits.signinCodeVerify)

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      {
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult),
      }
    )
  }

  try {
    const body = await request.json()
    const { email, code } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const normalizedCode = code.trim()

    // Find the verification record
    const verificationRecord = await db.query.verification.findFirst({
      where: and(
        eq(verification.identifier, `signin:${normalizedEmail}`),
        gt(verification.expiresAt, new Date())
      ),
    })

    if (!verificationRecord) {
      return NextResponse.json({ error: 'Code expired or not found' }, { status: 400 })
    }

    // Verify the code using constant-time comparison to prevent timing attacks
    const recordBuffer = Buffer.from(verificationRecord.value, 'utf8')
    const codeBuffer = Buffer.from(normalizedCode, 'utf8')
    if (recordBuffer.length !== codeBuffer.length || !timingSafeEqual(recordBuffer, codeBuffer)) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Code is valid - delete it (one-time use)
    await db.delete(verification).where(eq(verification.id, verificationRecord.id))

    // Find all workspaces where this email has a user account
    // In the org-scoped model, we look for users with this email across all orgs
    const usersWithEmail = await db
      .select({
        userId: user.id,
        organizationId: user.organizationId,
      })
      .from(user)
      .where(eq(user.email, normalizedEmail))

    if (usersWithEmail.length === 0) {
      // Email verified but no workspaces found
      return NextResponse.json({ workspaces: [] })
    }

    // Get workspace details for each org

    // Fetch organizations, their primary domains, and user roles
    const workspaces: WorkspaceInfo[] = []

    for (const userRecord of usersWithEmail) {
      // Get organization
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, userRecord.organizationId),
      })

      if (!org) continue

      // Get primary domain
      const domain = await db.query.workspaceDomain.findFirst({
        where: and(eq(workspaceDomain.organizationId, org.id), eq(workspaceDomain.isPrimary, true)),
      })

      // Get user's role in this org
      const memberRecord = await db.query.member.findFirst({
        where: and(eq(member.userId, userRecord.userId), eq(member.organizationId, org.id)),
      })

      workspaces.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        domain: domain?.domain || `${org.slug}.quackback.io`,
        logoUrl: org.logo,
        role: memberRecord?.role || 'user',
      })
    }

    // Sort by name
    workspaces.sort((a, b) => a.name.localeCompare(b.name))

    // Store verified email in a short-lived token for the redirect step
    // This prevents someone from skipping verification
    const verifiedEmailToken = crypto.randomUUID()
    await db.insert(verification).values({
      id: generateId('verification'),
      identifier: `verified-email:${verifiedEmailToken}`,
      value: normalizedEmail,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    })

    return NextResponse.json({
      workspaces,
      // Include token in response for the redirect step
      verifiedEmailToken,
    })
  } catch (error) {
    console.error('Error verifying signin code:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
