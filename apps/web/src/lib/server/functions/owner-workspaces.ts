import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export const listOwnerWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  if (!cloud.enabled || !(cloud.canUpgrade || cloud.canManageBilling)) return []
  try {
    const { fetchOwnerWorkspaces } = await import('@/lib/server/control-plane/client')
    return await fetchOwnerWorkspaces()
  } catch (error) {
    const { ControlPlaneUnavailableError } = await import('@/lib/server/control-plane/client')
    if (error instanceof ControlPlaneUnavailableError) return []
    throw error
  }
})

export const openOwnerWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(z.object({ instanceId: z.string().trim().min(1) }).strict())
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { openOwnerWorkspace } = await import('@/lib/server/control-plane/client')
    return { url: await openOwnerWorkspace(data.instanceId) }
  })
