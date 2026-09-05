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
  integrationConfig: Record<string, unknown>
): Promise<void> {
  if (!config.isPooledTenancy) return
  const install = getIntegration(type)?.install
  const externalId = install?.externalId(integrationConfig)
  if (!externalId) return
  try {
    await putWorkspaceControlPlane('/api/v1/internal/integration-installs', {
      provider: type,
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
    logger.warn({ err: error, integration_type: type }, 'integration routing unregister failed')
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
  const rows = await db.query.integrations.findMany({ where: eq(integrations.status, 'active') })
  for (const row of rows) {
    try {
      await registerInstall(row.integrationType, (row.config ?? {}) as Record<string, unknown>)
    } catch (error) {
      if (!(error instanceof InstallBoundElsewhereError)) throw error
      logger.warn(
        { integration_type: row.integrationType },
        'integration routing backfill conflict'
      )
    }
  }
}
