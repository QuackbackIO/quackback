import { NextRequest, NextResponse } from 'next/server'
import { db, verification, workspaceDomain, eq } from '@/lib/db'
import { sendSigninCodeEmail } from '@quackback/email'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import { generateId } from '@quackback/ids'

/**
 * Generate a 6-digit code
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * POST /api/auth/tenant-otp/send
 *
 * Send a verification code to an email address for tenant authentication.
 * Works for both login and signup flows - doesn't check if user exists.
 *
 * The code is org-scoped to prevent cross-tenant code reuse.
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`tenant-otp:${clientIp}`, rateLimits.signinCode)

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult),
      }
    )
  }

  try {
    // Get workspace from host header
    const host = request.headers.get('host')
    if (!host) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Look up workspace from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, host),
      with: { workspace: true },
    })

    const org = domainRecord?.workspace
    if (!org) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Use org-scoped identifier to prevent cross-tenant code reuse
    const identifier = `tenant-otp:${org.id}:${normalizedEmail}`

    // Delete any existing codes for this email in this org
    await db.delete(verification).where(eq(verification.identifier, identifier))

    // Generate and store new code
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await db.insert(verification).values({
      id: generateId('verification'),
      identifier,
      value: code,
      expiresAt,
    })

    // Send email
    try {
      await sendSigninCodeEmail({ to: normalizedEmail, code })
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError)
      // Don't reveal email sending failures to prevent enumeration
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in tenant-otp/send:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
