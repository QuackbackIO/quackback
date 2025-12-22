import { NextRequest, NextResponse } from 'next/server'
import { db, verification, user, member, eq } from '@/lib/db'
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
 * POST /api/onboarding/send-code
 *
 * Send a verification code to an email address for onboarding.
 * This is the first step - works without any existing data.
 * Only allows sending codes if no owner exists yet (fresh install).
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`onboarding-code:${clientIp}`, rateLimits.signinCode)

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
    // Check if an owner already exists - if so, onboarding is complete
    const existingOwner = await db.query.member.findFirst({
      where: eq(member.role, 'owner'),
    })

    if (existingOwner) {
      return NextResponse.json({ error: 'Setup already completed' }, { status: 400 })
    }

    const body = (await request.json()) as { email?: string }
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
    await db.delete(verification).where(eq(verification.identifier, `onboarding:${normalizedEmail}`))

    // Generate and store new code
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await db.insert(verification).values({
      id: generateId('verification'),
      identifier: `onboarding:${normalizedEmail}`,
      value: code,
      expiresAt,
    })

    // Send email
    try {
      await sendSigninCodeEmail({ to: normalizedEmail, code })
    } catch (emailError) {
      console.error('Failed to send onboarding code email:', emailError)
      // Don't reveal email sending failures to prevent enumeration
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in onboarding send-code:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
