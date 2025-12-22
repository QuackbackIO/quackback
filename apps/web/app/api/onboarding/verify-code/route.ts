import { NextRequest, NextResponse } from 'next/server'
import { db, verification, user, member, session, eq } from '@/lib/db'
import { generateId } from '@quackback/ids'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import crypto from 'crypto'

/**
 * Generate a session ID and token compatible with better-auth format.
 */
function generateSessionCredentials() {
  // Better-auth uses nanoid-like format for session IDs
  const sessionId = crypto.randomBytes(16).toString('base64url')
  // Token is used in cookies - use a longer random string
  const token = crypto.randomBytes(32).toString('base64url')
  return { sessionId, token }
}

/**
 * POST /api/onboarding/verify-code
 *
 * Verify the OTP code and create the owner account.
 * This is the first step of onboarding - works without settings.
 * Only works when no owner exists yet (fresh install).
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`onboarding-verify:${clientIp}`, rateLimits.signinCode)

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

    const body = (await request.json()) as { email?: string; code?: string; name?: string }
    const { email, code, name } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Find the verification record
    const verificationRecord = await db.query.verification.findFirst({
      where: eq(verification.identifier, `onboarding:${normalizedEmail}`),
    })

    if (!verificationRecord) {
      return NextResponse.json({ error: 'No verification code found. Please request a new code.' }, { status: 400 })
    }

    // Check if code matches
    if (verificationRecord.value !== code) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Check if code is expired
    if (new Date() > verificationRecord.expiresAt) {
      // Clean up expired code
      await db.delete(verification).where(eq(verification.id, verificationRecord.id))
      return NextResponse.json({ error: 'Code has expired. Please request a new code.' }, { status: 400 })
    }

    // Check if this user already exists
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, normalizedEmail),
    })

    if (existingUser) {
      // User exists - create member as owner and create session
      const existingMember = await db.query.member.findFirst({
        where: eq(member.userId, existingUser.id),
      })

      if (existingMember) {
        // Update to owner role
        await db.update(member).set({ role: 'owner' }).where(eq(member.id, existingMember.id))
      } else {
        // Create member record as owner
        await db.insert(member).values({
          id: generateId('member'),
          userId: existingUser.id,
          role: 'owner',
          createdAt: new Date(),
        })
      }

      // Delete the verification code
      await db.delete(verification).where(eq(verification.id, verificationRecord.id))

      // Create a session directly
      const { sessionId, token } = generateSessionCredentials()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

      await db.insert(session).values({
        id: sessionId,
        userId: existingUser.id,
        token,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: clientIp,
        userAgent: request.headers.get('user-agent') || null,
      })

      // Create response with session cookie
      const response = NextResponse.json({
        success: true,
        isNewUser: false,
      })

      // Set the session cookie (better-auth expects this format)
      response.cookies.set('better-auth.session_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      })

      return response
    }

    // New user - need name
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      // Signal that we need the name
      return NextResponse.json({
        success: true,
        action: 'needsName',
      })
    }

    // Create the new user
    const [newUser] = await db.insert(user).values({
      id: generateId('user'),
      email: normalizedEmail,
      name: name.trim(),
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()

    // Create the member record as owner
    await db.insert(member).values({
      id: generateId('member'),
      userId: newUser.id,
      role: 'owner',
      createdAt: new Date(),
    })

    // Delete the verification code
    await db.delete(verification).where(eq(verification.id, verificationRecord.id))

    // Create a session directly
    const { sessionId, token } = generateSessionCredentials()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.insert(session).values({
      id: sessionId,
      userId: newUser.id,
      token,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: clientIp,
      userAgent: request.headers.get('user-agent') || null,
    })

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      isNewUser: true,
    })

    // Set the session cookie (better-auth expects this format)
    response.cookies.set('better-auth.session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    })

    return response
  } catch (error) {
    console.error('Error in onboarding verify-code:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
