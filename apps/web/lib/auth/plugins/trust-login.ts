/**
 * Trust Login Plugin for Better-Auth
 *
 * This plugin provides a secure way to create sessions for users who have
 * been authenticated through a trusted flow (e.g., workspace creation, OAuth callback).
 *
 * It exposes a `/trust-login` endpoint that:
 * 1. Validates a one-time transfer token from the database
 * 2. Validates target domain matches current host (prevents token theft)
 * 3. Deletes token (one-time use)
 * 4. For portal OAuth, creates member record with role='user' if needed
 * 5. Creates a proper session using Better-Auth's internal adapter
 * 6. Sets the session cookie correctly
 * 7. Redirects to the callback URL
 *
 * This approach ensures sessions are created in the exact format Better-Auth expects,
 * avoiding issues with manual session insertion.
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { z } from 'zod'
import { db, sessionTransferToken, member, workspaceDomain, eq, and, gt } from '@/lib/db'
import { generateId } from '@quackback/ids'

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

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

          const currentHost = normalizeHost(ctx.request?.headers?.get('host') || '')
          if (!currentHost) {
            return ctx.redirect('/login?error=invalid_domain')
          }

          // 1-3. Atomically consume transfer token (one-time use)
          // Prevents race conditions where multiple requests could redeem the same token.
          const transfer = await db.transaction(async (tx) => {
            const [consumed] = await tx
              .delete(sessionTransferToken)
              .where(
                and(
                  eq(sessionTransferToken.token, token),
                  gt(sessionTransferToken.expiresAt, new Date())
                )
              )
              .returning()
            return consumed
          })

          // 2. Validate target domain matches current host (prevents token theft)
          if (!transfer) {
            return ctx.redirect('/login?error=invalid_token')
          }

          if (currentHost !== normalizeHost(transfer.targetDomain)) {
            return ctx.redirect('/login?error=invalid_domain')
          }

          // 4. For portal context, ensure member record with role='user' exists
          // (OAuth signup creates user but member may not exist)
          if (transfer.context === 'portal') {
            // Look up organization from target domain
            const domainRecord = await db.query.workspaceDomain.findFirst({
              where: eq(workspaceDomain.domain, transfer.targetDomain),
              columns: { organizationId: true },
            })

            if (domainRecord) {
              // Check if member record already exists
              const existingMember = await db.query.member.findFirst({
                where: and(
                  eq(member.userId, transfer.userId),
                  eq(member.organizationId, domainRecord.organizationId)
                ),
              })

              // Create member record with role='user' if it doesn't exist
              if (!existingMember) {
                await db.insert(member).values({
                  id: generateId('member'),
                  userId: transfer.userId,
                  organizationId: domainRecord.organizationId,
                  role: 'user',
                  createdAt: new Date(),
                })
              }
            }
          }

          // 5. Create session using Better-Auth's internal adapter
          // All users (team + portal) have member records with unified roles
          const session = await ctx.context.internalAdapter.createSession(
            transfer.userId,
            false // dontRememberMe
          )

          if (!session) {
            return ctx.redirect('/login?error=session_error')
          }

          // 6. Set the session cookie
          await ctx.setSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            session.token,
            ctx.context.secret,
            ctx.context.authCookies.sessionToken.options
          )

          // 7. Redirect based on context and popup mode
          // Check if this is a popup window that should redirect to auth-complete
          const requestUrl = new URL(ctx.request?.url || 'http://localhost')
          const isPopup = requestUrl.searchParams.get('popup') === 'true'

          if (isPopup) {
            // Popup mode: redirect to auth-complete page which broadcasts success
            return ctx.redirect('/auth-complete')
          }

          // Normal mode: use callbackUrl from transfer token
          // The callbackUrl is validated to be a relative path (starts with /)
          // and was set during the OTP/OAuth flow, so it's safe to use
          let redirectUrl = transfer.callbackUrl || (transfer.context === 'portal' ? '/' : '/admin')

          // Security: ensure redirectUrl is a relative path to prevent open redirects
          if (!redirectUrl.startsWith('/') || redirectUrl.startsWith('//')) {
            redirectUrl = transfer.context === 'portal' ? '/' : '/admin'
          }

          return ctx.redirect(redirectUrl)
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
