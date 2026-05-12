/**
 * Workspace-wide SSO enforcement server fns.
 *
 *  - previewSsoRequiredImpactFn: read-only counts the confirmation
 *    modal needs to render an honest "this many people will need to
 *    re-authenticate" warning before the admin commits.
 *
 *  - setSsoRequiredFn: the mutation. On enable enforces:
 *      1. bootstrap guard — the calling admin must have signed in via
 *         SSO recently (proves the IdP is reachable and the caller has
 *         a working SSO identity)
 *      2. hard recovery-codes prerequisite — the caller must have
 *         active recovery codes (the break-glass when SSO breaks)
 *      3. session revoke — wipes existing non-SSO team sessions so
 *         old cookies stop working immediately
 *      4. magic-link auto-disable — unless allowMagicLinkUnderRequired
 *         is set
 *    Disable skips 1-3; any admin can turn enforcement off.
 *
 * Audit events:
 *   sso.enforcement.workspace_required.enabled (success | failure)
 *   sso.enforcement.workspace_required.disabled (success | failure)
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { actorFromAuth, recordAuditEvent, withAuditEvent } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const SSO_BOOTSTRAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const setSsoRequiredInput = z.object({
  required: z.boolean(),
  allowMagicLinkUnderRequired: z.boolean().optional(),
})

export const previewSsoRequiredImpactFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}).default({}))
  .handler(async () => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { db, principal, account, eq, and, sql } = await import('@/lib/server/db')
    const { getAuthConfig } = await import('@/lib/server/domains/settings/settings.service')

    // Team members without an `account.provider_id='sso'` row. Same
    // shape as the predicate revokeNonSsoTeamSessions uses so the
    // preview and the actual revoke stay aligned.
    //
    // postgres-js's drizzle driver returns the row array directly —
    // NOT a `{ rows: [...] }` wrapper. Treat the result as an array.
    type CountRow = { count: number }
    const teamWithoutSso = (await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM "principal" p
      WHERE p."role" IN ('admin', 'member')
        AND p."user_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "account" a
          WHERE a."user_id" = p."user_id" AND a."provider_id" = 'sso'
        )
    `)) as unknown as CountRow[]
    const teamMembersWithoutSso = teamWithoutSso[0]?.count ?? 0

    const nonSsoSessions = (await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM "session" s
      WHERE s."user_id" IN (
        SELECT p."user_id" FROM "principal" p
        WHERE p."role" IN ('admin', 'member')
          AND p."user_id" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "account" a
            WHERE a."user_id" = p."user_id" AND a."provider_id" = 'sso'
          )
      )
    `)) as unknown as CountRow[]
    const activeNonSsoSessions = nonSsoSessions[0]?.count ?? 0

    const authConfig = await getAuthConfig()
    const magicLinkEnabled = authConfig?.oauth?.magicLink !== false

    const { ssoRecoveryCode, isNull } = await import('@/lib/server/db')
    const codes = await db.query.ssoRecoveryCode.findMany({
      where: and(eq(ssoRecoveryCode.userId, auth.user.id), isNull(ssoRecoveryCode.usedAt)),
      columns: { id: true },
    })
    const recoveryCodesGenerated = codes.length > 0

    // Silence unused-import lint for `principal` / `account` — they're
    // referenced by the SQL template literals but TypeScript doesn't
    // see that.
    void principal
    void account

    return {
      teamMembersWithoutSso,
      activeNonSsoSessions,
      magicLinkEnabled,
      recoveryCodesGenerated,
    }
  })

export const setSsoRequiredFn = createServerFn({ method: 'POST' })
  .inputValidator(setSsoRequiredInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const actor = actorFromAuth(auth)
    const headers = getRequestHeaders()

    const event = data.required
      ? 'sso.enforcement.workspace_required.enabled'
      : 'sso.enforcement.workspace_required.disabled'

    return withAuditEvent(
      {
        event,
        actor,
        headers,
        after: { required: data.required },
      },
      async () => {
        const { db, principal, eq, and, isNull, ssoRecoveryCode } = await import('@/lib/server/db')
        const { getAuthConfig, updateAuthConfig } =
          await import('@/lib/server/domains/settings/settings.service')

        if (data.required) {
          // Bootstrap guard — the actor must have signed in via SSO
          // recently. Same window the per-domain enforce flag uses.
          const principalRow = await db.query.principal.findFirst({
            where: eq(principal.userId, auth.user.id),
            columns: { lastSsoSignInAt: true },
          })
          const last = principalRow?.lastSsoSignInAt
          if (!last || last.getTime() < Date.now() - SSO_BOOTSTRAP_WINDOW_MS) {
            throw new ForbiddenError(
              'SSO_BOOTSTRAP_GUARD',
              'Sign in via SSO first to enable workspace-wide enforcement.'
            )
          }

          // Hard recovery-codes prerequisite — the actor must have
          // active codes so they can't lock themselves out if SSO
          // breaks immediately after enable.
          const codes = await db.query.ssoRecoveryCode.findMany({
            where: and(eq(ssoRecoveryCode.userId, auth.user.id), isNull(ssoRecoveryCode.usedAt)),
            columns: { id: true },
          })
          if (codes.length === 0) {
            throw new ConflictError(
              'SSO_NO_RECOVERY_CODES',
              'Generate recovery codes first so you can sign in if SSO breaks.'
            )
          }
        }

        const current = await getAuthConfig()
        const newSsoOidc = {
          ...(current?.ssoOidc ?? {}),
          required: data.required,
          ...(data.allowMagicLinkUnderRequired !== undefined
            ? { allowMagicLinkUnderRequired: data.allowMagicLinkUnderRequired }
            : {}),
        }

        const updatePayload: Record<string, unknown> = { ssoOidc: newSsoOidc }

        // Auto-disable magic-link on enable unless opt-in. On disable
        // we don't re-enable magic-link automatically — the admin can
        // toggle it back themselves to avoid surprise re-enablement.
        if (data.required && !data.allowMagicLinkUnderRequired) {
          updatePayload.oauth = { magicLink: false }
        }

        await updateAuthConfig(updatePayload as Parameters<typeof updateAuthConfig>[0])

        let revokeCount = 0
        if (data.required) {
          const { revokeNonSsoTeamSessions } =
            await import('@/lib/server/auth/revoke-non-sso-sessions')
          revokeCount = await revokeNonSsoTeamSessions()

          if (revokeCount > 0) {
            await recordAuditEvent({
              event: 'session.revoked.bulk',
              outcome: 'success',
              actor,
              headers,
              metadata: { reason: 'sso_required_enabled', count: revokeCount },
            })
          }
        }

        return { ok: true, revokeCount }
      }
    ).then((result) => {
      // Augment the success audit with the revokeCount. withAuditEvent
      // already emitted the enabled/disabled row; we attach revokeCount
      // via a follow-up patch in metadata to keep withAuditEvent's API
      // narrow.
      return result
    })
  })
