import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateApiTenantAccess } from '@/lib/tenant'
import { isCloud, type PricingTier } from '@quackback/domain/features'
import { createCheckoutSession, isStripeConfigured } from '@quackback/ee/billing'
import { getSubscriptionByOrganizationIdAdmin } from '@quackback/db/queries/subscriptions'
import { db, workspaceDomain, eq, and } from '@quackback/db'

const checkoutSchema = z.object({
  organizationId: z.string(),
  tier: z.enum(['essentials', 'professional', 'team']),
})

/**
 * Get the tenant URL for an organization (supports custom domains and subdomains)
 */
async function getTenantUrl(organizationId: string): Promise<string> {
  const domain = await db.query.workspaceDomain.findFirst({
    where: and(
      eq(workspaceDomain.organizationId, organizationId),
      eq(workspaceDomain.isPrimary, true)
    ),
  })

  if (!domain) {
    throw new Error(`No primary workspace domain found for organization: ${organizationId}`)
  }

  return `https://${domain.domain}`
}

/**
 * POST /api/stripe/checkout
 * Create a Stripe Checkout session for subscribing to a plan.
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
    const result = checkoutSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { organizationId, tier } = result.data

    // Validate tenant access (only owners/admins can manage billing)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get existing subscription to check for existing Stripe customer
    const existingSubscription = await getSubscriptionByOrganizationIdAdmin(organizationId)

    // Build success/cancel URLs using tenant's primary domain
    const tenantUrl = await getTenantUrl(organizationId)
    const successUrl = `${tenantUrl}/admin/settings/billing?success=true`
    const cancelUrl = `${tenantUrl}/admin/settings/billing?canceled=true`

    // Create checkout session
    const session = await createCheckoutSession({
      organizationId,
      organizationName: validation.organization.name,
      tier: tier as Exclude<PricingTier, 'enterprise'>,
      customerEmail: validation.user.email,
      existingCustomerId: existingSubscription?.stripeCustomerId ?? undefined,
      successUrl,
      cancelUrl,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Checkout session error:', error)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
