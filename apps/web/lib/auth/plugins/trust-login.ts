/**
 * Trust Login Plugin for Better-Auth
 *
 * This plugin provides a secure way to create sessions for users who have
 * been authenticated through a trusted flow (e.g., workspace creation, OAuth callback).
 *
 * It exposes a `/trust-login` endpoint that:
 * 1. Validates a one-time transfer token from the database
 * 2. Creates a proper session using Better-Auth's internal adapter
 * 3. Sets the session cookie correctly
 * 4. Redirects to the callback URL
 *
 * This approach ensures sessions are created in the exact format Better-Auth expects,
 * avoiding issues with manual session insertion.
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { z } from 'zod'
import { db, sessionTransferToken, eq, and, gt } from '@quackback/db'

export const trustLogin = () => {
  return {
    id: 'trust-login',
    endpoints: {
      trustLogin: createAuthEndpoint(
        '/trust-login',
        {
          method: 'GET',
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const { token } = ctx.query

          // 1. Find and validate transfer token
          const transfer = await db.query.sessionTransferToken.findFirst({
            where: and(
              eq(sessionTransferToken.token, token),
              gt(sessionTransferToken.expiresAt, new Date())
            ),
          })

          if (!transfer) {
            return ctx.redirect('/login?error=invalid_token')
          }

          // 2. Validate target domain matches current host (prevents token theft)
          const currentHost = ctx.request?.headers?.get('host') || ''
          const expectedPrefix = `${transfer.targetSubdomain}.`
          if (!currentHost.startsWith(expectedPrefix)) {
            // Token was issued for a different subdomain - reject
            await db.delete(sessionTransferToken).where(eq(sessionTransferToken.id, transfer.id))
            return ctx.redirect('/login?error=invalid_domain')
          }

          // 3. Delete token (one-time use)
          await db.delete(sessionTransferToken).where(eq(sessionTransferToken.id, transfer.id))

          // 4. Create session using Better-Auth's internal adapter
          const session = await ctx.context.internalAdapter.createSession(
            transfer.userId,
            false // dontRememberMe
          )

          if (!session) {
            return ctx.redirect('/login?error=session_error')
          }

          // 5. Set the session cookie
          await ctx.setSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            session.token,
            ctx.context.secret,
            ctx.context.authCookies.sessionToken.options
          )

          // 6. Redirect to admin dashboard (hardcoded to prevent open redirect)
          return ctx.redirect('/admin')
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
