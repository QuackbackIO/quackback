import { NextRequest, NextResponse } from 'next/server'
import { isCloud } from '@quackback/domain/features'
import {
  isCloudflareConfigured,
  verifyWebhookSignature,
  processWebhookEvent,
  type CFWebhookPayload,
} from '@quackback/ee/cloudflare'

/**
 * Cloudflare Webhook API
 *
 * Receives webhook events from Cloudflare for SSL status changes
 * on custom hostnames. Updates domain records with current status.
 *
 * Configure webhook in Cloudflare dashboard:
 * Zone > Custom Hostnames > Notifications
 */

export async function POST(request: NextRequest) {
  // Only available in cloud edition
  if (!isCloud()) {
    return NextResponse.json(
      { error: 'Cloudflare integration not available in self-hosted mode' },
      { status: 400 }
    )
  }

  if (!isCloudflareConfigured()) {
    return NextResponse.json({ error: 'Cloudflare not configured' }, { status: 400 })
  }

  // Verify webhook signature
  const signature = request.headers.get('cf-webhook-auth')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const payload = await request.text()

  try {
    // Verify signature if webhook secret is configured
    const webhookSecret = process.env.CLOUDFLARE_WEBHOOK_SECRET
    if (webhookSecret) {
      if (!verifyWebhookSignature(payload, signature)) {
        console.error('[CF Webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = JSON.parse(payload) as CFWebhookPayload
    console.log(`[CF Webhook] Received event: ${event.event} for hostname: ${event.data.hostname}`)

    const handled = await processWebhookEvent(event)

    if (!handled) {
      console.warn('[CF Webhook] Event not handled:', event.event)
    }

    return NextResponse.json({ received: true, handled })
  } catch (error) {
    console.error('[CF Webhook] Processing error:', error)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
