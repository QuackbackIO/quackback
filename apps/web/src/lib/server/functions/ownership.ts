import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { ControlPlaneUnavailableError } from '@/lib/server/control-plane/client'

const FREE_WORKSPACE_OWNER_CAP = 'free_workspace_owner_cap'

async function cloudBillingOn(): Promise<boolean> {
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  return cloud.enabled && (cloud.canUpgrade || cloud.canManageBilling)
}

export const getCloudOwnerEmailFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth()
  if (!(await cloudBillingOn())) return null
  try {
    const { fetchWorkspaceOwnerEmail } = await import('@/lib/server/control-plane/client')
    return await fetchWorkspaceOwnerEmail()
  } catch (error) {
    if (error instanceof ControlPlaneUnavailableError) return null
    throw error
  }
})

export const transferWorkspaceOwnershipFn = createServerFn({ method: 'POST' })
  .validator(z.object({ toEmail: z.string().trim().email() }).strict())
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!(await cloudBillingOn())) {
      throw new Error('Cloud workspace actions are not available')
    }
    const { fetchWorkspaceOwnerEmail, transferWorkspaceOwnership } =
      await import('@/lib/server/control-plane/client')
    const owner = await fetchWorkspaceOwnerEmail()
    const me = auth.user.email?.trim().toLowerCase()
    if (!me || !owner || me !== owner.trim().toLowerCase()) {
      throw new Error('Only the owner can transfer this workspace')
    }
    const toEmail = data.toEmail.trim().toLowerCase()
    try {
      await transferWorkspaceOwnership(toEmail)
      const { enqueueMembershipSync } =
        await import('@/lib/server/domains/principals/membership-sync')
      await enqueueMembershipSync()
    } catch (error) {
      if (
        error instanceof ControlPlaneUnavailableError &&
        error.message.includes(FREE_WORKSPACE_OWNER_CAP)
      ) {
        throw new Error(
          'That teammate already owns 3 live Free workspaces. They need to delete or upgrade one first.'
        )
      }
      throw error
    }
    return { ownerEmail: toEmail }
  })

export const leaveCloudWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(z.object({}).strict())
  .handler(async () => {
    const auth = await requireAuth()
    if (!(await cloudBillingOn())) {
      throw new Error('Cloud workspace actions are not available')
    }
    const email = auth.user.email?.trim().toLowerCase()
    if (!email) throw new Error('You need an email to leave')
    const { fetchWorkspaceOwnerEmail, leaveCloudWorkspace } =
      await import('@/lib/server/control-plane/client')
    const owner = await fetchWorkspaceOwnerEmail()
    if (owner && email === owner.trim().toLowerCase()) {
      throw new Error('The owner cannot leave. Transfer the workspace first.')
    }
    const { leaveTeamSelf } = await import('@/lib/server/domains/principals/principal.service')
    const { actorFromAuth } = await import('@/lib/server/audit/log')
    await leaveTeamSelf(auth.principal.id, actorFromAuth(auth), getRequestHeaders())
    try {
      await leaveCloudWorkspace(email)
    } catch (error) {
      if (error instanceof ControlPlaneUnavailableError) return { left: true as const }
      throw error
    }
    return { left: true as const }
  })
