import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, organization, eq } from '@quackback/db'
import { auth } from '@/lib/auth'
import { z } from 'zod'

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
  organizationId: z.string().uuid(),
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

  const organizationId = request.nextUrl.searchParams.get('organizationId')
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
  }

  // Verify user is admin/owner of this org
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    with: {
      members: {
        where: (members, { eq }) => eq(members.userId, session.user.id),
      },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  const member = org.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all domains for this org
  const domains = await db.query.workspaceDomain.findMany({
    where: eq(workspaceDomain.organizationId, organizationId),
    orderBy: (wd, { desc }) => [desc(wd.isPrimary), desc(wd.createdAt)],
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

  const { domain, organizationId } = result.data

  // Verify user is admin/owner of this org
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    with: {
      members: {
        where: (members, { eq }) => eq(members.userId, session.user.id),
      },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
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

  // Create domain (no verification token needed - we verify via CNAME)
  const domainId = crypto.randomUUID()

  await db.insert(workspaceDomain).values({
    id: domainId,
    organizationId,
    domain,
    domainType: 'custom',
    isPrimary: false,
    verified: false,
    verificationToken: null,
    createdAt: new Date(),
  })

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
  })
}

/**
 * DELETE /api/domains - Remove a custom domain
 */
export async function DELETE(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const domainId = request.nextUrl.searchParams.get('id')
  if (!domainId) {
    return NextResponse.json({ error: 'Domain ID is required' }, { status: 400 })
  }

  // Get the domain
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      organization: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id),
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
  const member = domain.organization.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await db.delete(workspaceDomain).where(eq(workspaceDomain.id, domainId))

  return NextResponse.json({ success: true })
}
