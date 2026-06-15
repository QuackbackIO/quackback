/**
 * Admin-only server function to reset another user's two-factor enrollment.
 *
 * Recovery path: a team member who has lost both their authenticator app
 * and their backup codes asks an admin to clear their enrollment so they
 * can re-enroll from scratch. We delete the twoFactor row, flip
 * user.twoFactorEnabled off, and prune any Better-Auth trust-device
 * verification records so previously-trusted browsers must re-challenge.
 *
 * Every call is logged for audit.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { UserId } from '@quackback/ids'
import { z } from 'zod'
import { and, db, eq, like, twoFactor, user, verification } from '@/lib/server/db'
import { actorFromAuth, withAuditEvent } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'admin' })

const input = z.object({
  userId: z.string().regex(/^user_/),
})

export const adminResetTwoFactorFn = createServerFn({ method: 'POST' })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const userId = data.userId as UserId

    return withAuditEvent(
      {
        event: 'two_factor.reset_by_admin',
        actor: actorFromAuth(auth),
        target: { type: 'user', id: userId },
        headers: getRequestHeaders(),
      },
      async () => {
        // Wrap the three writes in a tx so a mid-flight failure can't
        // leave the user in a partial state (e.g. twoFactor row gone
        // but twoFactorEnabled still true, or trust-device records
        // lingering).
        await db.transaction(async (tx) => {
          await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
          await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId))
          await tx
            .delete(verification)
            .where(
              and(like(verification.identifier, 'trust-device-%'), eq(verification.value, userId))
            )
        })

        log.info({ admin_id: auth.user.id, user_id: userId }, 'reset 2fa for user')
        return { success: true }
      }
    )
  })
