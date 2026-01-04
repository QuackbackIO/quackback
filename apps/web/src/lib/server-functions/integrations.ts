import { createServerFn } from '@tanstack/react-start'

/**
 * Generate a signed OAuth connect URL for Slack.
 * Returns a relative URL path for use in the same origin.
 */
export const getSlackConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    // Dynamic imports to avoid client bundling of DB code
    const { createHmac, randomBytes } = await import('crypto')
    const { db, member, eq } = await import('@/lib/db')
    const { getSession } = await import('./auth')

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

    // Validate user has admin/owner role
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Not authenticated')
    }

    const appSettings = await db.query.settings.findFirst()
    if (!appSettings) {
      throw new Error('Settings not found')
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
    })

    if (!memberRecord || memberRecord.role !== 'admin') {
      throw new Error('Forbidden')
    }

    // Generate signed state
    const nonce = randomBytes(16).toString('base64url')
    const timestamp = Date.now()
    const state = signState({
      orgId: appSettings.id,
      memberId: memberRecord.id,
      nonce,
      timestamp,
    })

    // Return relative URL to connect endpoint with signed state
    return `/api/integrations/slack/connect?state=${encodeURIComponent(state)}`
  }
)
