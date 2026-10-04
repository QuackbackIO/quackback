import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  workspaceCopilotAvailable,
  assertWorkspaceCopilotAvailable,
} from '@/lib/server/domains/assistant/workspace-copilot-gate'
import {
  createWorkspaceThread,
  listWorkspaceThreads,
  readWorkspaceThread,
} from '@/lib/server/domains/assistant/workspace-threads.service'
import type { WorkspaceCopilotAvailability } from '@/lib/shared/assistant/workspace-contract'

export const getWorkspaceCopilotAvailabilityFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceCopilotAvailability> => {
    const auth = await requireAuth(),
      actor = await policyActorFromAuth(auth)
    const enabled = await workspaceCopilotAvailable(actor)
    if (!enabled) return { enabled }
    const { aiCreditsNow } = await import('@/lib/server/domains/settings/tier-enforce')
    return { enabled, credits: await aiCreditsNow() }
  }
)
export const listWorkspaceCopilotThreadsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth(),
    actor = await policyActorFromAuth(auth)
  return listWorkspaceThreads(actor)
})
export const createWorkspaceCopilotThreadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ title: z.string().max(120).optional() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth(),
      actor = await policyActorFromAuth(auth)
    await assertWorkspaceCopilotAvailable(actor)
    return createWorkspaceThread(actor, data.title)
  })
export const getWorkspaceCopilotThreadFn = createServerFn({ method: 'GET' })
  .validator(z.object({ threadKey: z.string().max(200) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth(),
      actor = await policyActorFromAuth(auth)
    return readWorkspaceThread(data.threadKey, actor)
  })

export const applyWorkspaceSettingsProposalFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ pendingActionId: z.string(), selectedChangeIds: z.array(z.string()).min(1).max(80) })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth(),
      actor = await policyActorFromAuth(auth)
    const { applyWorkspaceSettingsProposal } =
      await import('@/lib/server/domains/assistant/workspace-settings-actions.service')
    const row = await applyWorkspaceSettingsProposal(
      actor,
      data.pendingActionId as import('@quackback/ids').AssistantPendingActionId,
      data.selectedChangeIds
    )
    return {
      id: row.id,
      status: row.status,
      result: row.result as import('@/lib/shared/json').JsonValue | null,
    }
  })
export const undoWorkspaceSettingsProposalFn = createServerFn({ method: 'POST' })
  .validator(z.object({ pendingActionId: z.string() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth(),
      actor = await policyActorFromAuth(auth)
    const { undoWorkspaceSettingsProposal } =
      await import('@/lib/server/domains/assistant/workspace-settings-actions.service')
    const row = await undoWorkspaceSettingsProposal(
      actor,
      data.pendingActionId as import('@quackback/ids').AssistantPendingActionId
    )
    return {
      id: row.id,
      status: row.status,
      result: row.result as import('@/lib/shared/json').JsonValue | null,
    }
  })
