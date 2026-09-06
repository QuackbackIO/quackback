import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  putWorkspaceControlPlane,
  deleteWorkspaceControlPlane,
  getWorkspaceControlPlane,
  ControlPlaneUnavailableError,
} from '@/lib/server/control-plane/client'
import { getIntegration } from './index'

export class InstallBoundElsewhereError extends Error {
  constructor() {
    super('This account is already connected to another Quackback workspace.')
    this.name = 'InstallBoundElsewhereError'
  }
}
export async function registerInstall(
  type: string,
  integrationConfig: Record<string, unknown>,
  accessToken?: string
): Promise<void> {
  if (!config.isPooledTenancy) return
  const install = getIntegration(type)?.install
  const externalId = install?.externalId(integrationConfig)
  if (!externalId) return
  try {
    await putWorkspaceControlPlane('/api/v1/internal/integration-installs', {
      provider: type,
      accessToken,
      externalId,
      metadata: install?.metadata?.(integrationConfig) ?? {},
    })
  } catch (error) {
    if (error instanceof ControlPlaneUnavailableError && error.status === 409)
      throw new InstallBoundElsewhereError()
    throw error
  }
}
export async function unregisterInstall(
  type: string,
  integrationConfig: Record<string, unknown>
): Promise<void> {
  if (!config.isPooledTenancy) return
  const externalId = getIntegration(type)?.install?.externalId(integrationConfig)
  if (!externalId) return
  try {
    await deleteWorkspaceControlPlane(
      `/api/v1/internal/integration-installs/${encodeURIComponent(type)}/${encodeURIComponent(externalId)}`
    )
  } catch (error) {
    logger.warn({ integration_type: type }, 'integration routing unregister failed')
    throw error
  }
}
export async function getInstallRouting(
  type: string
): Promise<{ externalId: string; revokedAt: string | null }[]> {
  if (!config.isPooledTenancy) return []
  const result = await getWorkspaceControlPlane<{
    installs: { externalId: string; revokedAt: string | null }[]
  }>(`/api/v1/internal/integration-installs?provider=${encodeURIComponent(type)}`)
  return result.installs
}
/** Explicit one-shot per-workspace job, never scheduled on boot. */
export async function backfillIntegrationInstalls(): Promise<void> {
  const { db, integrations, eq } = await import('@/lib/server/db')
  const { decryptSecrets } = await import('./encryption')
  const rows = await db.query.integrations.findMany({ where: eq(integrations.status, 'active') })
  for (const row of rows) {
    try {
      await registerInstall(
        row.integrationType,
        (row.config ?? {}) as Record<string, unknown>,
        row.secrets ? decryptSecrets<{ accessToken?: string }>(row.secrets).accessToken : undefined
      )
    } catch (error) {
      if (!(error instanceof InstallBoundElsewhereError)) throw error
      logger.warn(
        { integration_type: row.integrationType },
        'integration routing backfill conflict'
      )
    }
  }
}

export async function cleanupPreviousInstall(
  type: string,
  oldConfig: Record<string, unknown>
): Promise<void> {
  if (!config.isPooledTenancy) return
  const { db, integrations, eq, sql } = await import('@/lib/server/db')
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`integration:${type}`}))`)
    const current = await tx.query.integrations.findFirst({
      where: eq(integrations.integrationType, type),
    })
    const identity = getIntegration(type)?.install?.externalId
    if (
      current?.status === 'active' &&
      identity?.((current.config ?? {}) as Record<string, unknown>) === identity?.(oldConfig)
    )
      return
    await unregisterInstall(type, oldConfig)
  })
}
