import { NextRequest, NextResponse } from 'next/server'
import { db, user, session, eq, and } from '@/lib/db'
import { generateId } from '@quackback/ids'

/**
 * POST /api/test/create-session
 *
 * Test-only endpoint to create sessions directly without OTP.
 * ONLY AVAILABLE IN TEST/DEV ENVIRONMENTS.
 *
 * Body: { email: string }
 * Returns: { sessionToken: string }
 */
export async function POST(request: NextRequest) {
  // Only allow in test/dev environments
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Get organization from host header
    const host = request.headers.get('host')
    if (!host) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Look up organization from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: (fields, ops) => ops.eq(fields.domain, host),
      with: { organization: true },
    })

    const org = domainRecord?.organization
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
    }

    // Find user
    const existingUser = await db.query.user.findFirst({
      where: and(eq(user.email, normalizedEmail), eq(user.organizationId, org.id)),
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Create session
    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.insert(session).values({
      id: generateId('session'),
      token: sessionToken,
      userId: existingUser.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      sessionToken,
      userId: existingUser.id,
    })
  } catch (error) {
    console.error('Error in test/create-session:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
