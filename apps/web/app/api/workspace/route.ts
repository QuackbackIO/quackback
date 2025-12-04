import { NextRequest, NextResponse } from 'next/server'
import {
  db,
  organization,
  user,
  member,
  account,
  eq,
  sessionTransferToken,
  workspaceDomain,
  seedDefaultStatuses,
} from '@quackback/db'
import { createWorkspaceSchema } from '@/lib/schemas/auth'
import { getBaseDomain } from '@/lib/routing'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'

/**
 * Hash password using bcryptjs
 * Compatible with Better-Auth's custom bcrypt verification
 */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * Generate a secure token
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Get host from request, throwing if missing
 */
function getHostFromRequest(request: NextRequest): string {
  const host = request.headers.get('host')
  if (!host) {
    throw new Error('Missing host header')
  }
  return host
}

/**
 * Build domain host string for workspace_domain table
 *
 * example.com -> acme.example.com
 * localhost:3000 -> acme.localhost:3000
 */
function buildDomainHost(slug: string, request: NextRequest): string {
  const host = getHostFromRequest(request)
  const baseDomain = getBaseDomain(host)
  return `${slug}.${baseDomain}`
}

/**
 * Build subdomain URL for redirect
 *
 * example.com -> acme.example.com
 * localhost:3000 -> acme.localhost:3000
 */
function buildSubdomainUrl(slug: string, request: NextRequest): string {
  const host = getHostFromRequest(request)
  const baseDomain = getBaseDomain(host)
  const protocol = request.headers.get('x-forwarded-proto') || 'http'
  return `${protocol}://${slug}.${baseDomain}`
}

/**
 * Create Workspace API
 *
 * Creates a new organization and owner user in a single transaction.
 * This is the entry point for self-service tenant provisioning.
 *
 * Flow:
 * 1. Validate input
 * 2. Check slug availability
 * 3. Create organization
 * 4. Create user with organizationId
 * 5. Create account (password)
 * 6. Create member (owner role)
 * 7. Create one-time transfer token
 * 8. Return redirect URL to subdomain /api/auth/complete with token
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = getClientIp(request.headers)
  const rateLimitResult = checkRateLimit(`workspace:${clientIp}`, rateLimits.workspaceCreation)

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

    // Validate input
    const parsed = createWorkspaceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { workspaceName, workspaceSlug, name, email, password } = parsed.data

    // Check if slug is already taken
    const existingOrg = await db.query.organization.findFirst({
      where: eq(organization.slug, workspaceSlug),
    })

    if (existingOrg) {
      return NextResponse.json({ error: 'This workspace URL is already taken' }, { status: 409 })
    }

    // Check if email is already registered
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (existingUser) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 409 })
    }

    // Generate IDs
    const orgId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const domainId = crypto.randomUUID()
    const tokenId = crypto.randomUUID()

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Generate transfer token
    const transferToken = generateSecureToken()

    // Build domain host
    const domainHost = buildDomainHost(workspaceSlug, request)

    // Create everything in a transaction (atomic operation)
    await db.transaction(async (tx) => {
      // 1. Create organization first
      await tx.insert(organization).values({
        id: orgId,
        name: workspaceName,
        slug: workspaceSlug,
        createdAt: new Date(),
      })

      // 2. Create user with organizationId
      await tx.insert(user).values({
        id: userId,
        name,
        email,
        emailVerified: false,
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // 3. Create account (password credential)
      await tx.insert(account).values({
        id: accountId,
        userId,
        accountId: userId, // For credential accounts, accountId = userId
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // 4. Create member with owner role
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId: orgId,
        role: 'owner',
        createdAt: new Date(),
      })

      // 5. Create workspace domain record for subdomain
      await tx.insert(workspaceDomain).values({
        id: domainId,
        organizationId: orgId,
        domain: domainHost,
        domainType: 'subdomain',
        isPrimary: true,
        verified: true,
      })

      // 6. Create one-time transfer token
      // Compute target domain before inserting (matches workspace_domain table)
      const subdomainUrl = buildSubdomainUrl(workspaceSlug, request)
      const targetDomain = new URL(subdomainUrl).host

      await tx.insert(sessionTransferToken).values({
        id: tokenId,
        token: transferToken,
        userId,
        targetDomain,
        callbackUrl: '/admin',
        expiresAt: new Date(Date.now() + 60000), // 60 seconds
      })
    })

    // Seed default post statuses for the new organization
    // Done outside transaction as it uses the main db connection
    await seedDefaultStatuses(orgId)

    // Redirect to subdomain with transfer token
    const redirectSubdomainUrl = buildSubdomainUrl(workspaceSlug, request)

    return NextResponse.json({
      success: true,
      redirectUrl: `${redirectSubdomainUrl}/api/auth/trust-login?token=${transferToken}`,
    })
  } catch (error) {
    // Check for unique constraint violations
    if (error instanceof Error && error.message.includes('unique')) {
      return NextResponse.json(
        { error: 'This email or workspace URL is already taken' },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}
