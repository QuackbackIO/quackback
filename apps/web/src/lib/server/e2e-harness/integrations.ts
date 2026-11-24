/**
 * The e2e integration connector: connect an integration with a test token,
 * skipping only the provider's OAuth screens.
 *
 * Reached only through `/api/e2e/integrations/connect`, behind the harness
 * gate (`./gate.ts`). It calls the app's own install path (`saveIntegration`,
 * the same call the OAuth callback makes after the code exchange), so the row
 * gets encrypted secrets, a service principal, the provider's config and its
 * `onConnect` step exactly as a real connect would. Pair it with the provider
 * fake (`./provider-fake.ts`) so the token is never sent to a real provider.
 */
import type { PrincipalId } from '@quackback/ids'
import { and, asc, db, eq, integrations, principal } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'e2e-integration-connect' })

export type E2eConnectResult =
  | { ok: true; integrationId: string; integrationType: string }
  | { ok: false; status: 400; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The workspace's first admin teammate: who "connected" it when no one is named. */
async function firstAdminPrincipalId(): Promise<PrincipalId | null> {
  const row = await db.query.principal.findFirst({
    where: and(eq(principal.role, 'admin'), eq(principal.type, 'user')),
    orderBy: [asc(principal.createdAt)],
    columns: { id: true },
  })
  return (row?.id as PrincipalId | undefined) ?? null
}

/**
 * Validate a request body and connect the integration it names.
 *
 * Body: `{ type, accessToken?, refreshToken?, expiresIn?, secrets?, config?, principalId?, reuseExisting? }`.
 * Leave `refreshToken`/`expiresIn` out unless the test is about refresh: with
 * them the app may call the provider's token endpoint.
 */
export async function connectE2eIntegration(body: unknown): Promise<E2eConnectResult> {
  const input = isRecord(body) ? body : {}
  const type = typeof input.type === 'string' ? input.type : ''

  const { getIntegration } = await import('@/lib/server/integrations')
  if (!type || !getIntegration(type)) {
    return { ok: false, status: 400, error: `Unknown integration type "${type}"` }
  }
  if (input.config !== undefined && !isRecord(input.config)) {
    return { ok: false, status: 400, error: 'config must be an object' }
  }
  if (input.secrets !== undefined && !isRecord(input.secrets)) {
    return { ok: false, status: 400, error: 'secrets must be an object' }
  }
  if (
    input.expiresIn !== undefined &&
    (typeof input.expiresIn !== 'number' || !(input.expiresIn > 0))
  ) {
    return { ok: false, status: 400, error: 'expiresIn must be a positive number of seconds' }
  }

  // Parallel tests share one row per provider, and a reconnect moves the
  // installation (connectedAt), which cancels work still queued under the old
  // one. A test that only needs the integration connected asks to reuse it.
  if (input.reuseExisting === true) {
    const existing = await db.query.integrations.findFirst({
      where: and(eq(integrations.integrationType, type), eq(integrations.status, 'active')),
      columns: { id: true },
    })
    if (existing) return { ok: true, integrationId: existing.id, integrationType: type }
  }

  const principalId =
    (optionalString(input.principalId) as PrincipalId | undefined) ??
    (await firstAdminPrincipalId())
  if (!principalId) return { ok: false, status: 400, error: 'No admin to connect as' }

  const { saveIntegration } = await import('@/lib/server/integrations/save')
  const integrationId = await saveIntegration(type, {
    principalId,
    accessToken: optionalString(input.accessToken),
    refreshToken: optionalString(input.refreshToken),
    expiresIn: input.expiresIn as number | undefined,
    secrets: input.secrets as Record<string, unknown> | undefined,
    config: input.config as Record<string, unknown> | undefined,
  })
  log.info({ integration_type: type, integration_id: integrationId }, 'e2e integration connected')
  return { ok: true, integrationId, integrationType: type }
}
