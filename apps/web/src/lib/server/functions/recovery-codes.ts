/**
 * Server functions for SSO recovery codes.
 *
 *  - generateRecoveryCodesFn: admin-only. Drops the caller's prior
 *    active batch, generates 10 fresh codes, hashes them, inserts,
 *    and returns the plaintext codes ONCE (the admin must save them
 *    before navigating away).
 *  - listRecoveryCodesFn: admin-only. Returns metadata only — never
 *    plaintext or hash — scoped to the calling user.
 *
 * Scoping is implicit: both fns operate on `auth.user.id`, so an
 * admin can only ever manage their own codes. Operators that want to
 * generate codes for another user must do so via a separate audit-
 * tagged endpoint (out of scope for v0.11).
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { UserId } from '@quackback/ids'
import { and, db, eq, isNull, ssoRecoveryCode } from '@/lib/server/db'
import { actorFromAuth, recordAuditEvent } from '@/lib/server/audit/log'
import { generateRecoveryCode, hashRecoveryCode } from '@/lib/server/auth/recovery-codes'
import { requireAuth } from './auth-helpers'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'

const RECOVERY_CODE_BATCH_SIZE = 10

export const generateRecoveryCodesFn = createServerFn({ method: 'POST' })
  .validator(z.object({}).default({}))
  .handler(async () => {
    const auth = await requireAuth({ roles: ['admin'] })
    const userId = auth.user.id as UserId

    // Drop the prior active batch. Soft-invalidating (setting used_at)
    // would clutter the metadata view; hard-deleting is simpler and
    // matches the "fresh batch supersedes the old one" UX.
    await db
      .delete(ssoRecoveryCode)
      .where(and(eq(ssoRecoveryCode.userId, userId), isNull(ssoRecoveryCode.usedAt)))

    const codes = Array.from({ length: RECOVERY_CODE_BATCH_SIZE }, () => generateRecoveryCode())
    const rows = await Promise.all(
      codes.map(async (code) => ({
        userId,
        codeHash: await hashRecoveryCode(code),
      }))
    )
    await db.insert(ssoRecoveryCode).values(rows)

    await recordAuditEvent({
      event: 'sso.recovery_codes.generated',
      outcome: 'success',
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'user', id: userId },
      metadata: { count: RECOVERY_CODE_BATCH_SIZE },
    })

    return { codes }
  })

export const listRecoveryCodesFn = createServerFn({ method: 'GET' })
  .validator(z.object({}).default({}))
  .handler(async () => {
    const auth = await requireAuth({ roles: ['admin'] })
    const userId = auth.user.id as UserId

    const rows = await db.query.ssoRecoveryCode.findMany({
      where: eq(ssoRecoveryCode.userId, userId),
      columns: { id: true, usedAt: true, createdAt: true },
      orderBy: (codes, { desc }) => [desc(codes.createdAt)],
    })

    return {
      codes: rows.map((row) => ({
        id: row.id,
        usedAt: toIsoStringOrNull(row.usedAt),
        createdAt: toIsoString(row.createdAt),
      })),
    }
  })
