import { NextRequest, NextResponse } from 'next/server'
import {
  db,
  organization,
  user,
  member,
  eq,
  sessionTransferToken,
  workspaceDomain,
} from '@quackback/db'
import { createWorkspaceSchema } from '@/lib/schemas/auth'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import { getStatusService } from '@/lib/services'
import { generateId } from '@quackback/ids'

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
 * Build domain host string for workspace_domain table
 *
 * Uses the request host as the base domain directly.
 * quackback.ngrok.app -> acme.quackback.ngrok.app
 * localhost:3000 -> acme.localhost:3000
 */
function buildDomainHost(slug: string, host: string): string {
  return `${slug}.${host}`
}

/**
 * Build subdomain URL for redirect
 */
function buildSubdomainUrl(slug: string, request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:3000'
  const protocol = request.headers.get('x-forwarded-proto') || 'http'
  return `${protocol}://${slug}.${host}`
}

/**
 * Create Workspace API
 *
 * Creates a new organization and owner user in a single transaction.
 * This is the entry point for self-service tenant provisioning.
 *
 * Users are org-scoped identities. Workspace owners get a member record with role='owner'.
 * No password is stored - authentication is via email OTP codes.
 *
 * Flow:
 * 1. Validate input
 * 2. Check slug availability
 * 3. Create organization
 * 4. Create user (org-scoped identity)
 * 5. Create member (owner role)
 * 6. Create one-time transfer token
 * 7. Return redirect URL to subdomain /api/auth/trust-login with token
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

    const { workspaceName, workspaceSlug, name, email } = parsed.data

    // Check if slug is already taken
    const existingOrg = await db.query.organization.findFirst({
      where: eq(organization.slug, workspaceSlug),
    })

    if (existingOrg) {
      return NextResponse.json({ error: 'This workspace URL is already taken' }, { status: 409 })
    }

    // Note: In the unified org-scoped model, the same email can be used across different orgs.
    // No need to check for existing users globally since each org has isolated user identities.

    // Generate IDs
    const orgId = generateId('org')
    const userId = generateId('user')
    const memberId = generateId('member')
    const domainId = generateId('domain')
    const tokenId = generateId('transfer_token')

    // Generate transfer token
    const transferToken = generateSecureToken()

    // Build domain host from request
    const host = request.headers.get('host') || 'localhost:3000'
    const domainHost = buildDomainHost(workspaceSlug, host)

    // Create everything in a transaction (atomic operation)
    await db.transaction(async (tx) => {
      // 1. Create organization first
      await tx.insert(organization).values({
        id: orgId,
        name: workspaceName,
        slug: workspaceSlug,
        createdAt: new Date(),
      })

      // 2. Create user (org-scoped identity, no password)
      // Users are scoped to a single organization
      await tx.insert(user).values({
        id: userId,
        organizationId: orgId,
        name,
        email,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // 3. Create member with owner role
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId: orgId,
        role: 'owner',
        createdAt: new Date(),
      })

      // 4. Create workspace domain record for subdomain
      await tx.insert(workspaceDomain).values({
        id: domainId,
        organizationId: orgId,
        domain: domainHost,
        domainType: 'subdomain',
        isPrimary: true,
        verified: true,
      })

      // 5. Create one-time transfer token
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
    const seedResult = await getStatusService().seedDefaultStatuses(orgId)
    if (!seedResult.success) {
      console.error('Failed to seed default statuses:', seedResult.error)
      // Continue even if seeding fails - workspace is still created
    }

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
