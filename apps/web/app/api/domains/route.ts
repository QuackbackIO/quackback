import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, workspace, eq, and } from '@/lib/db'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { generateId, isValidTypeId, type WorkspaceId, type DomainId } from '@quackback/ids'
import { isCloud } from '@quackback/domain/features'
import {
  isCloudflareConfigured,
  createCustomHostname,
  deleteCustomHostname,
} from '@quackback/ee/cloudflare'

/**
 * Custom Domain Management API
 *
 * Allows organization admins to add and manage custom domains.
 * Custom domains require DNS verification before they can be used.
 */

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .transform((d) => d.toLowerCase().trim())
    .refine((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d), {
      message: 'Invalid domain format',
    }),
  workspaceId: z.string().refine((id) => isValidTypeId(id, 'workspace'), {
    message: 'Invalid organization ID format',
  }) as z.ZodType<WorkspaceId>,
})

function getCnameTarget(): string {
  const appDomain = process.env.APP_DOMAIN
  if (!appDomain) {
    throw new Error('APP_DOMAIN is required')
  }
  return appDomain
}

/**
 * GET /api/domains - List custom domains for an organization
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceIdParam = request.nextUrl.searchParams.get('workspaceId')
  if (!workspaceIdParam || !isValidTypeId(workspaceIdParam, 'workspace')) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }
  const workspaceId = workspaceIdParam as WorkspaceId

  // Verify user is admin/owner of this org
  const org = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    with: {
      members: {
        where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
      },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const member = org.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all domains for this org, ordered by creation date (oldest first)
  const domains = await db.query.workspaceDomain.findMany({
    where: eq(workspaceDomain.workspaceId, workspaceId),
    orderBy: (wd, { asc }) => [asc(wd.createdAt)],
  })

  return NextResponse.json({ domains })
}

/**
 * POST /api/domains - Add a custom domain
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = addDomainSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { domain, workspaceId } = result.data

  // Verify user is admin/owner of this org
  const org = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    with: {
      members: {
        where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
      },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const member = org.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check if domain already exists (globally unique)
  const existingDomain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.domain, domain),
  })

  if (existingDomain) {
    return NextResponse.json({ error: 'Domain is already in use' }, { status: 409 })
  }

  // Create domain with verification token for HTTP verification (self-hosted fallback)
  const domainId = generateId('domain')
  const verificationToken = `qb_${crypto.randomUUID().replace(/-/g, '')}`

  await db.insert(workspaceDomain).values({
    id: domainId,
    workspaceId,
    domain,
    domainType: 'custom',
    isPrimary: false,
    verified: false,
    verificationToken,
    createdAt: new Date(),
  })

  // If cloud edition + Cloudflare configured, register with Cloudflare immediately
  let cloudflareData = null
  if (isCloud() && isCloudflareConfigured()) {
    try {
      const cfHostname = await createCustomHostname({
        hostname: domain,
        workspaceId,
      })

      // Store CF hostname ID and initial status
      await db
        .update(workspaceDomain)
        .set({
          cloudflareHostnameId: cfHostname.id,
          sslStatus: cfHostname.ssl.status,
          ownershipStatus: cfHostname.status,
          // Clear verification token since CF handles verification
          verificationToken: null,
        })
        .where(eq(workspaceDomain.id, domainId))

      cloudflareData = {
        hostnameId: cfHostname.id,
        sslStatus: cfHostname.ssl.status,
        ownershipStatus: cfHostname.status,
      }
    } catch (error) {
      console.error('[Domains API] Failed to register with Cloudflare:', error)
      // Don't fail the request - domain is created, CF can be retried
    }
  }

  const newDomain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
  })

  const cnameTarget = getCnameTarget()
  return NextResponse.json({
    domain: newDomain,
    verificationRecord: {
      type: 'CNAME',
      name: domain,
      value: cnameTarget,
    },
    cloudflare: cloudflareData,
  })
}

/**
 * PATCH /api/domains - Update a domain (e.g., set as primary)
 */
export async function PATCH(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { domainId: domainIdParam, isPrimary } = body

  if (
    !domainIdParam ||
    typeof domainIdParam !== 'string' ||
    !isValidTypeId(domainIdParam, 'domain')
  ) {
    return NextResponse.json({ error: 'domainId is required' }, { status: 400 })
  }
  const domainId = domainIdParam as DomainId

  // Get the domain with org membership check
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      workspace: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
          },
        },
      },
    },
  })

  if (!domain) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  // Verify user is admin/owner
  const member = domain.workspace.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only verified domains can be set as primary
  if (isPrimary && !domain.verified) {
    return NextResponse.json(
      { error: 'Domain must be verified before setting as primary' },
      { status: 400 }
    )
  }

  // If setting as primary, unset all other domains first
  if (isPrimary) {
    await db
      .update(workspaceDomain)
      .set({ isPrimary: false })
      .where(eq(workspaceDomain.workspaceId, domain.workspaceId))

    await db
      .update(workspaceDomain)
      .set({ isPrimary: true })
      .where(eq(workspaceDomain.id, domainId))
  }

  const updatedDomain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
  })

  return NextResponse.json({ domain: updatedDomain })
}

/**
 * DELETE /api/domains - Remove a custom domain
 */
export async function DELETE(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const domainIdParam = request.nextUrl.searchParams.get('id')
  if (!domainIdParam || !isValidTypeId(domainIdParam, 'domain')) {
    return NextResponse.json({ error: 'Domain ID is required' }, { status: 400 })
  }
  const domainId = domainIdParam as DomainId

  // Get the domain
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      workspace: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
          },
        },
      },
    },
  })

  if (!domain) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  // Cannot delete subdomain (primary domain)
  if (domain.domainType === 'subdomain') {
    return NextResponse.json({ error: 'Cannot delete subdomain' }, { status: 400 })
  }

  // Verify user is admin/owner
  const member = domain.workspace.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // If deleting a primary custom domain, auto-promote subdomain to primary
  // This ensures the organization always has a reachable primary domain
  if (domain.isPrimary) {
    await db
      .update(workspaceDomain)
      .set({ isPrimary: true })
      .where(
        and(
          eq(workspaceDomain.workspaceId, domain.workspaceId),
          eq(workspaceDomain.domainType, 'subdomain')
        )
      )
  }

  // Delete from Cloudflare if it was registered
  if (isCloud() && isCloudflareConfigured() && domain.cloudflareHostnameId) {
    try {
      await deleteCustomHostname(domain.cloudflareHostnameId)
    } catch (error) {
      console.error('[Domains API] Failed to delete from Cloudflare:', error)
      // Continue with local deletion
    }
  }

  await db.delete(workspaceDomain).where(eq(workspaceDomain.id, domainId))

  return NextResponse.json({ success: true })
}
