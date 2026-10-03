import { db, eq, and, settings, workspaceExperiments } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { isAssistantConfigured } from './assistant.runtime'
import { isCopilotCapabilityEnabled } from '@/lib/server/domains/settings/settings.service'

export const WORKSPACE_COPILOT_EXPERIMENT = 'workspace-copilot'
export async function isWorkspaceCopilotEnabled(): Promise<boolean> {
  const [workspace] = await db.select({ id: settings.id }).from(settings).limit(1)
  if (!workspace) return false
  const [row] = await db
    .select({ enabled: workspaceExperiments.enabled })
    .from(workspaceExperiments)
    .where(
      and(
        eq(workspaceExperiments.settingsId, workspace.id),
        eq(workspaceExperiments.experimentId, WORKSPACE_COPILOT_EXPERIMENT)
      )
    )
    .limit(1)
  return row?.enabled === true
}
export async function workspaceCopilotAvailable(actor: Actor): Promise<boolean> {
  if (
    !actor.principalId ||
    (actor.role !== 'admin' && actor.role !== 'member') ||
    !can(actor, PERMISSIONS.COPILOT_USE)
  )
    return false
  return (
    isAssistantConfigured() &&
    (await isWorkspaceCopilotEnabled()) &&
    (await isCopilotCapabilityEnabled('qa'))
  )
}
export async function assertWorkspaceCopilotAvailable(actor: Actor): Promise<void> {
  if (!(await workspaceCopilotAvailable(actor)))
    throw new NotFoundError('WORKSPACE_COPILOT_UNAVAILABLE', 'Copilot is unavailable')
}
