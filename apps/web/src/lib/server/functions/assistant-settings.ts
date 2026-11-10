import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { actorFromAuth } from '@/lib/server/audit/log'
import {
  assistantToolRulesUpdateSchema,
  assistantIdentityUpdateSchema,
  assistantVoiceUpdateSchema,
  assistantAgentKnowledgeUpdateSchema,
  assistantCopilotKnowledgeUpdateSchema,
  assistantCopilotCapabilitiesUpdateSchema,
} from '@/lib/server/domains/settings/settings.assistant'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth, assertAnyPermission, assertPermission } from './auth-helpers'
import { AI_ANY_PERMISSIONS, aiPermissionForAgent } from '@/lib/shared/ai-permissions'
import { z } from 'zod'

const log = logger.child({ component: 'assistant-settings' })

export const getAssistantSettingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch assistant settings')
  assertAnyPermission(await requireAuth(), AI_ANY_PERMISSIONS)
  const { getAssistantSettings } = await import('@/lib/server/domains/settings/settings.assistant')
  const { isAssistantConfigured } = await import('@/lib/server/domains/assistant/assistant.runtime')
  const { getAiConfigIssue } = await import('@/lib/server/domains/ai/provider')
  // `aiAvailable` is whether an AI model is configured at all, so the pages can
  // say Copilot has nowhere to run instead of offering controls that do nothing.
  // `aiConfigIssue` says why AI is off although keys were set (both providers).
  return {
    ...(await getAssistantSettings()),
    aiAvailable: isAssistantConfigured(),
    aiConfigIssue: getAiConfigIssue(),
  }
})

function configActor(ctx: Awaited<ReturnType<typeof requireAuth>>) {
  return { ...actorFromAuth(ctx), headers: getRequestHeaders() }
}

export const updateAssistantIdentityFn = createServerFn({ method: 'POST' })
  .validator(assistantIdentityUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_CUSTOMER_MANAGE })
    const { updateAssistantIdentity } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantIdentity(data.expectedRevision, data.identity, configActor(ctx))
  })

export const updateAssistantVoiceFn = createServerFn({ method: 'POST' })
  .validator(assistantVoiceUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_CUSTOMER_MANAGE })
    const { updateAssistantVoice } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantVoice(data.expectedRevision, data.voice, configActor(ctx))
  })

export const updateAssistantAgentKnowledgeFn = createServerFn({ method: 'POST' })
  .validator(assistantAgentKnowledgeUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_CUSTOMER_MANAGE })
    const { updateAssistantAgentKnowledge } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantAgentKnowledge(
      data.expectedRevision,
      { agent: 'agent', knowledge: data.knowledge },
      configActor(ctx)
    )
  })

export const updateAssistantCopilotKnowledgeFn = createServerFn({ method: 'POST' })
  .validator(assistantCopilotKnowledgeUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_TEAMMATE_MANAGE })
    const { updateAssistantAgentKnowledge } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantAgentKnowledge(
      data.expectedRevision,
      { agent: 'copilot', knowledge: data.knowledge },
      configActor(ctx)
    )
  })

export const updateAssistantCopilotCapabilitiesFn = createServerFn({ method: 'POST' })
  .validator(assistantCopilotCapabilitiesUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_TEAMMATE_MANAGE })
    const { updateAssistantCopilotCapabilities } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantCopilotCapabilities(
      data.expectedRevision,
      data.capabilities,
      configActor(ctx)
    )
  })

export const updateAssistantToolRulesFn = createServerFn({ method: 'POST' })
  .validator(assistantToolRulesUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    assertPermission(ctx, aiPermissionForAgent(data.agent))
    const { updateAssistantToolRules } =
      await import('@/lib/server/domains/settings/settings.assistant')
    return updateAssistantToolRules(
      data.expectedRevision,
      { agent: data.agent, toolRules: data.toolRules },
      configActor(ctx)
    )
  })

export const updateWidgetAssistantDeploymentFn = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean(), respond: z.boolean() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.AI_CUSTOMER_MANAGE })
    const { updateWidgetAssistantDeployment } =
      await import('@/lib/server/domains/settings/settings.widget')
    return updateWidgetAssistantDeployment(data, configActor(ctx))
  })
