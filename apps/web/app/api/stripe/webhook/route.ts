import { NextRequest, NextResponse } from 'next/server'
import { isCloud } from '@quackback/domain/features'
import {
  constructWebhookEvent,
  processWebhookEvent,
  isStripeConfigured,
} from '@quackback/ee/billing'

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events.
 *
 * Important: This endpoint must NOT use the standard JSON body parser.
 * Stripe requires the raw body for signature verification.
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

    // Get the raw body for signature verification
    const payload = await request.text()

    // Get the Stripe signature header
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
    }

    // Verify and construct the event
    let event
    try {
      event = constructWebhookEvent(payload, signature)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
    }

    // Process the event
    const handled = await processWebhookEvent(event)

    if (handled) {
      console.log(`Processed Stripe event: ${event.type}`)
    } else {
      console.log(`Ignored Stripe event: ${event.type}`)
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    // Return 500 to tell Stripe to retry
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

/**
 * Stripe webhooks use POST, but we'll handle other methods gracefully
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint only accepts POST requests from Stripe.' },
    { status: 405 }
  )
}
