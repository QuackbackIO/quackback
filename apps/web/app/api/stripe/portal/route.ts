import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateApiTenantAccess } from '@/lib/tenant'
import { isCloud } from '@quackback/domain/features'
import { createPortalSession, isStripeConfigured } from '@quackback/ee/billing'
import { getSubscriptionByWorkspaceIdAdmin } from '@/lib/db'
import { db, workspaceDomain, eq, and } from '@/lib/db'
import { isValidTypeId, type WorkspaceId } from '@quackback/ids'

const portalSchema = z.object({
  workspaceId: z.string().refine((id) => isValidTypeId(id, 'workspace'), {
    message: 'Invalid organization ID format',
  }) as z.ZodType<WorkspaceId>,
})

/**
 * Get the tenant URL for an organization (supports custom domains and subdomains)
 */
async function getTenantUrl(workspaceId: WorkspaceId): Promise<string> {
  const domain = await db.query.workspaceDomain.findFirst({
    where: and(eq(workspaceDomain.workspaceId, workspaceId), eq(workspaceDomain.isPrimary, true)),
  })

  if (!domain) {
    throw new Error(`No primary workspace domain found for organization: ${workspaceId}`)
  }

  return `https://${domain.domain}`
}

/**
 * POST /api/stripe/portal
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function POST(request: NextRequest) {
  try {
    // Only available in cloud edition
    if (!isCloud()) {
      return NextResponse.json(
        { error: 'Billing is not available in self-hosted mode' },
        { status: 400 }
      )
    }

    // Check Stripe configuration
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 })
    }

    // Parse request body
    const body = await request.json()
    const result = portalSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { workspaceId } = result.data

    // Validate tenant access (only owners/admins can manage billing)
    const validation = await validateApiTenantAccess(workspaceId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get subscription to find Stripe customer ID
    const subscription = await getSubscriptionByWorkspaceIdAdmin(workspaceId)

    if (!subscription?.stripeCustomerId) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })
    }

    // Build return URL using tenant's primary domain
    const tenantUrl = await getTenantUrl(workspaceId)
    const returnUrl = `${tenantUrl}/admin/settings/billing`

    // Create portal session
    const session = await createPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Portal session error:', error)
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
  }
}
