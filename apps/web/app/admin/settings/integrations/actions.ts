'use server'

import { createHmac, randomBytes } from 'crypto'
import { requireTenantRole } from '@/lib/tenant'

function getHmacSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET not set')
  }
  return secret
}

function signState(data: {
  orgId: string
  memberId: string
  nonce: string
  timestamp: number
}): string {
  const payload = JSON.stringify(data)
  const hmac = createHmac('sha256', getHmacSecret())
  hmac.update(payload)
  const signature = hmac.digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${signature}`
}

/**
 * Generate a signed OAuth connect URL for Slack.
 * Returns a relative URL path for use in the same origin.
 */
export async function getSlackConnectUrl(): Promise<string> {
  // Validate user has admin/owner role
  const { settings, member } = await requireTenantRole(['owner', 'admin'])

  // Generate signed state
  const nonce = randomBytes(16).toString('base64url')
  const timestamp = Date.now()
  const state = signState({
    orgId: settings.id,
    memberId: member.id,
    nonce,
    timestamp,
  })

  // Return relative URL to connect endpoint with signed state
  return `/api/integrations/slack/connect?state=${encodeURIComponent(state)}`
}
