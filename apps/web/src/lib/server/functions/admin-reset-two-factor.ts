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
import type { UserId } from '@quackback/ids'
import { z } from 'zod'
import { and, db, eq, like, twoFactor, user, verification } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'

const input = z.object({
  userId: z.string().regex(/^user_/),
})

export const adminResetTwoFactorFn = createServerFn({ method: 'POST' })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const userId = data.userId as UserId

    await db.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId))
    await db
      .delete(verification)
      .where(and(like(verification.identifier, 'trust-device-%'), eq(verification.value, userId)))

    console.log(`[admin] admin=${auth.user.id} reset 2FA for user=${userId}`)
    return { success: true }
  })
