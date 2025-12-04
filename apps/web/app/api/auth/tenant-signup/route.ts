import { NextRequest, NextResponse } from 'next/server'
import { db, user, member, account, session, workspaceDomain, eq } from '@quackback/db'
import { tenantSignupSchema } from '@/lib/schemas/auth'
import bcrypt from 'bcryptjs'

/**
 * Hash password using bcryptjs
 * Compatible with Better-Auth's custom bcrypt verification
 */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * Generate a secure session token
 */
function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Tenant Signup API
 *
 * Creates a new team member in an existing tenant (organization).
 * Only works if the organization has openSignupEnabled = true.
 *
 * Flow:
 * 1. Get organization from host header via workspace_domain lookup
 * 2. Verify organization exists and has open signup enabled
 * 3. Check email uniqueness within the organization
 * 4. Create user with organizationId
 * 5. Create account (password)
 * 6. Create member (member role)
 * 7. Create session
 * 8. Return session token
 */
export async function POST(request: NextRequest) {
  try {
    // Get organization from host header via workspace_domain lookup
    const host = request.headers.get('host')
    if (!host) {
      return NextResponse.json(
        { error: 'Signup is only available on tenant domains' },
        { status: 400 }
      )
    }

    // Look up organization from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, host),
      with: { organization: true },
    })

    const org = domainRecord?.organization
    if (!org) {
      return NextResponse.json(
        { error: 'Signup is only available on tenant domains' },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Validate input
    const parsed = tenantSignupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { name, email, password } = parsed.data

    // Check if open signup is enabled
    if (!org.openSignupEnabled) {
      return NextResponse.json(
        { error: 'Signup is not enabled for this organization. Contact your administrator.' },
        { status: 403 }
      )
    }

    // Check if email already exists in this organization
    const existingUser = await db.query.user.findFirst({
      where: (u, { and, eq: equals }) =>
        and(equals(u.email, email), equals(u.organizationId, org.id)),
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists in this organization' },
        { status: 409 }
      )
    }

    // Generate IDs
    const userId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const sessionToken = generateSessionToken()

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create user with organizationId
    await db.insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: false,
      organizationId: org.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Create account (password credential)
    await db.insert(account).values({
      id: accountId,
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Create member with member role
    await db.insert(member).values({
      id: memberId,
      userId,
      organizationId: org.id,
      role: 'member',
      createdAt: new Date(),
    })

    // Create session
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    await db.insert(session).values({
      id: sessionId,
      token: sessionToken,
      userId,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('[Tenant Signup] Error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
