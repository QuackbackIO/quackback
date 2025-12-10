import { NextRequest, NextResponse } from 'next/server'
import { db, verification, eq } from '@quackback/db'
import { sendSigninCodeEmail } from '@quackback/email'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'

/**
 * Generate a 6-digit code
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * POST /api/auth/signin-code
 *
 * Send a verification code to an email address.
 * Used by the main domain workspace finder flow.
 *
 * This is NOT org-scoped - it just sends a code to verify email ownership.
 * The code verification step will then look up workspaces for that email.
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`signin-code:${clientIp}`, rateLimits.signinCode)

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

    // Delete any existing codes for this email
    await db.delete(verification).where(eq(verification.identifier, `signin:${normalizedEmail}`))

    // Generate and store new code
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `signin:${normalizedEmail}`,
      value: code,
      expiresAt,
    })

    // Send email
    try {
      await sendSigninCodeEmail({ to: normalizedEmail, code })
    } catch (emailError) {
      console.error('Failed to send signin code email:', emailError)
      // Don't reveal email sending failures to prevent enumeration
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in signin-code:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
