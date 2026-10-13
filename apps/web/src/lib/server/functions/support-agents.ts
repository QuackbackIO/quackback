import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { SupportAgentId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { isAdmin } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { requireRecentSignIn } from '@/lib/server/auth/recent-sign-in'
import { toRecentSignInRefusal } from '@/lib/shared/recent-sign-in'
import { assertOwnAgentAvailable } from '@/lib/server/domains/support-agents/availability'
import {
  getExternalSupportAgent,
  toSupportAgentView,
  registerExternalAgent,
  updateExternalAgent,
  rotateExternalAgentSecrets,
  deleteExternalAgent,
} from '@/lib/server/domains/support-agents/support-agents.service'
import { getAnswering, updateAnswering } from '@/lib/server/domains/settings/settings.answering'

const fields = z.object({
  name: z.string().trim().min(1).max(80),
  endpointUrl: z.string().trim().url().nullable(),
  replyDeadlineSeconds: z.number().int().min(5).max(120),
  fallback: z.enum(['team', 'quackback_ai']),
})
const action = z.discriminatedUnion('action', [
  fields.extend({ action: z.literal('create') }),
  fields.extend({
    action: z.literal('update'),
    id: z.string(),
    status: z.enum(['active', 'paused']),
  }),
  z.object({
    action: z.literal('rotate'),
    id: z.string(),
    which: z.enum(['credential', 'signing']),
  }),
  z.object({ action: z.literal('delete'), id: z.string() }),
])

export type SupportAgentAction = z.infer<typeof action>

export const getSupportAgentConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })
  const [agent, answering] = await Promise.all([getExternalSupportAgent(), getAnswering()])
  return { agent: agent ? toSupportAgentView(agent) : null, answering }
})

/** A dashboard admin manages credentials; a stale session returns the sign-in refusal value. */
export const manageSupportAgentFn = createServerFn({ method: 'POST' })
  .validator(action)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })
    if (!isAdmin(auth.principal.role))
      throw new ForbiddenError('ADMIN_REQUIRED', 'An admin must manage your AI agent')
    try {
      await requireRecentSignIn(auth)
    } catch (error) {
      const refusal = toRecentSignInRefusal(error)
      if (refusal) return refusal
      throw error
    }
    await assertOwnAgentAvailable()
    switch (data.action) {
      case 'create': {
        const registered = await registerExternalAgent(data)
        return {
          ok: true as const,
          agent: toSupportAgentView(registered.agent),
          credential: registered.credential,
          signingSecret: registered.signingSecret,
        }
      }
      case 'update':
        return {
          ok: true as const,
          agent: toSupportAgentView(await updateExternalAgent(data.id as SupportAgentId, data)),
        }
      case 'rotate': {
        const rotated = await rotateExternalAgentSecrets(data.id as SupportAgentId, data.which)
        return {
          ok: true as const,
          agent: toSupportAgentView(rotated.agent),
          ...(data.which === 'credential'
            ? { credential: rotated.secret }
            : { signingSecret: rotated.secret }),
        }
      }
      case 'delete':
        await deleteExternalAgent(data.id as SupportAgentId)
        return { ok: true as const, agent: null }
    }
  })

export const getAnsweringFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const [answering, agent] = await Promise.all([getAnswering(), getExternalSupportAgent()])
  return { ...answering, ownAgentReady: !!agent && agent.status === 'active' }
})

export const updateAnsweringFn = createServerFn({ method: 'POST' })
  .validator(z.object({ mode: z.enum(['quackback_ai', 'own_agent', 'team']) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    if (!isAdmin(auth.principal.role))
      throw new ForbiddenError('ADMIN_REQUIRED', 'An admin must choose who answers')
    try {
      await requireRecentSignIn(auth)
    } catch (error) {
      const refusal = toRecentSignInRefusal(error)
      if (refusal) return refusal
      throw error
    }
    await assertOwnAgentAvailable()
    if (data.mode === 'own_agent') {
      const agent = await getExternalSupportAgent()
      if (!agent || agent.status !== 'active')
        throw new ValidationError('AGENT_NOT_READY', 'Connect an active AI agent first')
    }
    return updateAnswering(data)
  })
