import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { ControlPlaneUnavailableError } from '@/lib/server/control-plane/client'

async function cloudBillingOn(): Promise<boolean> {
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  return cloud.enabled && (cloud.canUpgrade || cloud.canManageBilling)
}

export const wipeCloudWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(z.object({ confirm: z.literal('wipe') }).strict())
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!(await cloudBillingOn())) {
      throw new Error('Cloud workspace actions are not available')
    }
    const me = auth.user.email?.trim().toLowerCase()
    if (!me) throw new Error('You need an email to wipe this workspace')
    const { fetchWorkspaceOwnerEmail, wipeCloudWorkspace } =
      await import('@/lib/server/control-plane/client')
    const owner = await fetchWorkspaceOwnerEmail()
    if (!owner || me !== owner.trim().toLowerCase()) {
      throw new Error('Only the owner can wipe this workspace')
    }
    try {
      await wipeCloudWorkspace()
    } catch (error) {
      if (error instanceof ControlPlaneUnavailableError) {
        if (error.message.includes('already_deleted')) {
          throw new Error('This workspace is already deleted', { cause: error })
        }
        if (error.message.includes('not_owner')) {
          throw new Error('Only the owner can wipe this workspace', { cause: error })
        }
      }
      throw error
    }
    const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
    const dashboardUrl =
      raw && raw.startsWith('https://') ? `${raw.replace(/\/$/, '')}/dashboard` : '/'
    return { wiped: true as const, confirm: data.confirm, dashboardUrl }
  })
