import { NextRequest, NextResponse } from 'next/server'
import { db, user, member, account, workspaceDomain, sessionTransferToken, eq } from '@quackback/db'
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
 * Generate a secure random token
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Portal Signup API
 *
 * Creates a new portal user in an existing tenant (organization).
 * Uses portal auth settings (portalAuthEnabled, portalPasswordEnabled).
 *
 * Portal users get role='user' which allows them to:
 * - Vote and comment on the public portal
 * - Have their interactions tracked with their identity
 * - NOT access the admin dashboard (that requires member/admin/owner role)
 *
 * Flow:
 * 1. Get organization from host header via workspace_domain lookup
 * 2. Verify organization exists and has portal auth enabled
 * 3. Check email uniqueness within the organization
 * 4. Create user with organizationId
 * 5. Create account (password)
 * 6. Create member (user role)
 * 7. Create session transfer token
 * 8. Return redirect URL to trust-login (which creates proper signed session cookie)
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

    // Check if portal authentication is enabled
    if (!org.portalAuthEnabled) {
      return NextResponse.json(
        { error: 'Portal signup is not enabled for this organization.' },
        { status: 403 }
      )
    }

    // Check if password authentication is enabled for portal
    if (!org.portalPasswordEnabled) {
      return NextResponse.json(
        {
          error:
            'Password signup is not enabled for this portal. Try signing in with Google or GitHub.',
        },
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
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Generate IDs
    const userId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const transferTokenId = crypto.randomUUID()
    const transferToken = generateSecureToken()

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Use the full domain for transfer token (matches workspace_domain table)
    const targetDomain = domainRecord.domain

    // Create all records in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Create user with organizationId
      await tx.insert(user).values({
        id: userId,
        name,
        email,
        emailVerified: false,
        organizationId: org.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create account (password credential)
      await tx.insert(account).values({
        id: accountId,
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create member with 'user' role (portal-only access)
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId: org.id,
        role: 'user', // Portal users get 'user' role, not 'member'
        createdAt: new Date(),
      })

      // Create session transfer token (trust-login will create proper signed session)
      await tx.insert(sessionTransferToken).values({
        id: transferTokenId,
        token: transferToken,
        userId,
        targetDomain: targetDomain,
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 30000), // 30 seconds
        createdAt: new Date(),
      })
    })

    // Return redirect URL to trust-login endpoint
    const protocol = request.headers.get('x-forwarded-proto') || 'http'
    const redirectUrl = `${protocol}://${host}/api/auth/trust-login?token=${transferToken}`

    return NextResponse.json({
      success: true,
      redirectUrl,
    })
  } catch (error) {
    console.error('[Portal Signup] Error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
