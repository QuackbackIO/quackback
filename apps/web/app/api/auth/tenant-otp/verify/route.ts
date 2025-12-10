import { NextRequest, NextResponse } from 'next/server'
import {
  db,
  verification,
  user,
  account,
  member,
  invitation,
  workspaceDomain,
  sessionTransferToken,
  eq,
  and,
  gt,
} from '@quackback/db'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'

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
 * POST /api/auth/tenant-otp/verify
 *
 * Verify a tenant OTP code and handle login/signup.
 *
 * Login flow (user exists):
 * - Verify code
 * - Create session transfer token
 * - Return redirect URL to trust-login
 *
 * Signup flow (user doesn't exist):
 * - If name is provided: create user + member + session
 * - If no name: return { needsSignup: true } so frontend can collect name
 *
 * Invitation flow:
 * - Same as signup but uses role from invitation
 * - Marks invitation as accepted
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(
    `tenant-otp-verify:${clientIp}`,
    rateLimits.signinCodeVerify
  )

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
    // Get organization from host header
    const host = request.headers.get('host')
    if (!host) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Look up organization from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, host),
      with: { organization: true },
    })

    const org = domainRecord?.organization
    if (!org) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const body = await request.json()
    const { email, code, name, invitationId, context = 'portal', callbackUrl = '/' } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const normalizedCode = code.trim()
    const identifier = `tenant-otp:${org.id}:${normalizedEmail}`

    // Find the verification record
    const verificationRecord = await db.query.verification.findFirst({
      where: and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())),
    })

    if (!verificationRecord) {
      return NextResponse.json({ error: 'Code expired or not found' }, { status: 400 })
    }

    // Verify the code
    if (verificationRecord.value !== normalizedCode) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Code is valid - delete it (one-time use)
    await db.delete(verification).where(eq(verification.id, verificationRecord.id))

    // Check if user already exists in this org
    const existingUser = await db.query.user.findFirst({
      where: and(eq(user.email, normalizedEmail), eq(user.organizationId, org.id)),
    })

    if (existingUser) {
      // LOGIN FLOW - user exists
      const transferTokenId = crypto.randomUUID()
      const transferToken = generateSecureToken()

      await db.insert(sessionTransferToken).values({
        id: transferTokenId,
        token: transferToken,
        userId: existingUser.id,
        targetDomain: domainRecord.domain,
        callbackUrl,
        context,
        expiresAt: new Date(Date.now() + 30000), // 30 seconds
        createdAt: new Date(),
      })

      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      const redirectUrl = `${protocol}://${host}/api/auth/trust-login?token=${transferToken}`

      return NextResponse.json({
        success: true,
        action: 'login',
        redirectUrl,
      })
    }

    // SIGNUP FLOW - user doesn't exist

    // Check if portal auth is enabled (unless this is team context or invitation)
    if (context === 'portal' && !org.portalAuthEnabled && !invitationId) {
      return NextResponse.json(
        { error: 'Portal signup is not enabled for this organization.' },
        { status: 403 }
      )
    }

    // If no name provided, tell frontend to collect it
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({
        success: true,
        action: 'needsSignup',
        email: normalizedEmail,
      })
    }

    // Validate invitation if provided
    let validInvitation: {
      id: string
      role: string | null
      email: string
      organizationId: string
    } | null = null

    if (invitationId) {
      const inv = await db.query.invitation.findFirst({
        where: eq(invitation.id, invitationId),
      })

      if (!inv) {
        return NextResponse.json({ error: 'Invalid invitation' }, { status: 400 })
      }

      if (inv.organizationId !== org.id) {
        return NextResponse.json(
          { error: 'This invitation is for a different organization' },
          { status: 400 }
        )
      }

      if (inv.status !== 'pending') {
        return NextResponse.json(
          { error: 'This invitation has already been used or cancelled' },
          { status: 400 }
        )
      }

      if (new Date() > inv.expiresAt) {
        return NextResponse.json(
          { error: 'This invitation has expired. Please request a new one.' },
          { status: 400 }
        )
      }

      if (inv.email.toLowerCase() !== normalizedEmail) {
        return NextResponse.json(
          { error: 'Email does not match the invitation. Please use the invited email address.' },
          { status: 400 }
        )
      }

      validInvitation = inv
    } else if (context === 'team' && !org.openSignupEnabled) {
      // Team signup without invitation requires openSignupEnabled
      return NextResponse.json(
        { error: 'Signup is not enabled for this organization. Contact your administrator.' },
        { status: 403 }
      )
    }

    // Determine role
    const memberRole = validInvitation?.role || (context === 'team' ? 'member' : 'user')

    // Create user + account + member + session transfer token
    const userId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const transferTokenId = crypto.randomUUID()
    const transferToken = generateSecureToken()

    await db.transaction(async (tx) => {
      // Create user (org-scoped identity)
      await tx.insert(user).values({
        id: userId,
        organizationId: org.id,
        name: name.trim(),
        email: normalizedEmail,
        emailVerified: true, // Verified via OTP
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create account (no password for OTP-only users)
      await tx.insert(account).values({
        id: accountId,
        userId,
        accountId: userId,
        providerId: 'otp',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create member record with appropriate role
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId: org.id,
        role: memberRole,
        createdAt: new Date(),
      })

      // Mark invitation as accepted (if applicable)
      if (validInvitation) {
        await tx
          .update(invitation)
          .set({ status: 'accepted' })
          .where(eq(invitation.id, validInvitation.id))
      }

      // Create session transfer token
      await tx.insert(sessionTransferToken).values({
        id: transferTokenId,
        token: transferToken,
        userId,
        targetDomain: domainRecord.domain,
        callbackUrl,
        context,
        expiresAt: new Date(Date.now() + 30000), // 30 seconds
        createdAt: new Date(),
      })
    })

    const protocol = request.headers.get('x-forwarded-proto') || 'http'
    const redirectUrl = `${protocol}://${host}/api/auth/trust-login?token=${transferToken}`

    return NextResponse.json({
      success: true,
      action: 'signup',
      redirectUrl,
    })
  } catch (error) {
    console.error('Error in tenant-otp/verify:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
