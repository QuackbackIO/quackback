import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { isAssistantConfigured } from './assistant.runtime'
import {
  isCopilotCapabilityEnabled,
  isFeatureEnabled,
} from '@/lib/server/domains/settings/settings.service'

/** Copilot on Home is a normal feature flag: on for new workspaces, a Labs switch. */
export async function isWorkspaceCopilotEnabled(): Promise<boolean> {
  return isFeatureEnabled('copilotHome')
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
