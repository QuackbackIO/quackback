'use server'

import { createHmac, randomBytes } from 'crypto'
import { requireTenantRoleBySlug } from '@/lib/tenant'

const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:3000'
const IS_SECURE = !APP_DOMAIN.includes('localhost')

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
 * This runs on the server (tenant subdomain) where we have the user's session.
 * Returns a URL to the main domain with the signed state as a query param.
 */
export async function getSlackConnectUrl(orgSlug: string): Promise<string> {
  // Validate user has admin/owner role (this uses the session from tenant subdomain)
  const { workspace, member } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  // Generate signed state
  const nonce = randomBytes(16).toString('base64url')
  const timestamp = Date.now()
  const state = signState({
    orgId: workspace.id,
    memberId: member.id,
    nonce,
    timestamp,
  })

  // Build URL to main domain connect endpoint with signed state
  const protocol = IS_SECURE ? 'https' : 'http'
  return `${protocol}://${APP_DOMAIN}/api/integrations/slack/connect?state=${encodeURIComponent(state)}`
}
