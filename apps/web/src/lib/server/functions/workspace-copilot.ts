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
    const { aiAllowanceNow } = await import('@/lib/server/domains/settings/tier-enforce')
    return { enabled, ...(await aiAllowanceNow()) }
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
