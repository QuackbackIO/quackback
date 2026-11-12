import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { assertDashboardScope, requireAuth } from './auth-helpers'
import { ControlPlaneUnavailableError } from '@/lib/server/control-plane/client'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'

async function cloudBillingOn(): Promise<boolean> {
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  return cloud.enabled && (cloud.canUpgrade || cloud.canManageBilling)
}

export const wipeCloudWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(z.object({ confirm: z.literal('wipe') }).strict())
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    assertDashboardScope(auth)
    if (!(await cloudBillingOn())) {
      throw new ForbiddenError(
        'CLOUD_ACTIONS_UNAVAILABLE',
        'Cloud workspace actions are not available'
      )
    }
    const me = auth.user.email?.trim().toLowerCase()
    if (!me) throw new ForbiddenError('EMAIL_REQUIRED', 'You need an email to wipe this workspace')
    const { fetchWorkspaceOwnerEmail, wipeCloudWorkspace } =
      await import('@/lib/server/control-plane/client')
    const owner = await fetchWorkspaceOwnerEmail()
    if (!owner || me !== owner.trim().toLowerCase()) {
      throw new ForbiddenError('NOT_WORKSPACE_OWNER', 'Only the owner can wipe this workspace')
    }
    try {
      await wipeCloudWorkspace()
    } catch (error) {
      if (error instanceof ControlPlaneUnavailableError) {
        if (error.message.includes('already_deleted')) {
          throw new ConflictError(
            'WORKSPACE_ALREADY_DELETED',
            'This workspace is already deleted',
            error
          )
        }
        if (error.message.includes('not_owner')) {
          throw new ForbiddenError(
            'NOT_WORKSPACE_OWNER',
            'Only the owner can wipe this workspace',
            error
          )
        }
      }
      throw error
    }
    const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
    const dashboardUrl =
      raw && raw.startsWith('https://') ? `${raw.replace(/\/$/, '')}/dashboard` : '/'
    return { wiped: true as const, confirm: data.confirm, dashboardUrl }
  })
