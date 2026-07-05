/**
 * Guidance-rule CRUD and the tool catalogue projection for the assistant
 * customization settings UI. Guidance rules gate on assistant.manage, same as
 * assistant-settings.ts; the tool list is read-only metadata about the same
 * catalogue prompt assembly and the approval pipeline consume.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantGuidanceRuleId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ASSISTANT_SURFACES } from '@/lib/shared/assistant/surfaces'
import { ASSISTANT_GUIDANCE_CATEGORIES } from '@/lib/shared/assistant/guidance-categories'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-guidance' })

const surfacesSchema = z.array(z.enum(ASSISTANT_SURFACES)).nullable().optional()
const categorySchema = z.enum(ASSISTANT_GUIDANCE_CATEGORIES).optional()

const createGuidanceRuleSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(1000),
  enabled: z.boolean().optional(),
  surfaces: surfacesSchema,
  category: categorySchema,
})

const updateGuidanceRuleSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(1000).optional(),
  enabled: z.boolean().optional(),
  surfaces: surfacesSchema,
  category: categorySchema,
})

const reorderGuidanceRulesSchema = z.object({
  ids: z.array(z.string()).min(1),
})

const deleteGuidanceRuleSchema = z.object({ id: z.string() })

/** All guidance rules, enabled or not — the admin list shows every rule. */
export const listGuidanceRulesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list guidance rules')
  try {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { listGuidanceRules, GUIDANCE_CHAR_BUDGET } = await import(
      '@/lib/server/domains/assistant/guidance.service'
    )
    const rules = await listGuidanceRules({ enabledOnly: false })
    return { rules, charBudget: GUIDANCE_CHAR_BUDGET }
  } catch (error) {
    log.error({ err: error }, 'list guidance rules failed')
    throw error
  }
})

export const createGuidanceRuleFn = createServerFn({ method: 'POST' })
  .validator(createGuidanceRuleSchema)
  .handler(async ({ data }) => {
    log.info('create guidance rule')
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { createGuidanceRule } = await import('@/lib/server/domains/assistant/guidance.service')
      return await createGuidanceRule({
        title: data.title,
        body: data.body,
        enabled: data.enabled,
        surfaces: data.surfaces,
        category: data.category,
        createdById: ctx.principal.id,
      })
    } catch (error) {
      log.error({ err: error }, 'create guidance rule failed')
      throw error
    }
  })

export const updateGuidanceRuleFn = createServerFn({ method: 'POST' })
  .validator(updateGuidanceRuleSchema)
  .handler(async ({ data }) => {
    log.info('update guidance rule')
    try {
      await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { updateGuidanceRule } = await import('@/lib/server/domains/assistant/guidance.service')
      return await updateGuidanceRule(data.id as AssistantGuidanceRuleId, {
        title: data.title,
        body: data.body,
        enabled: data.enabled,
        surfaces: data.surfaces,
        category: data.category,
      })
    } catch (error) {
      log.error({ err: error }, 'update guidance rule failed')
      throw error
    }
  })

export const reorderGuidanceRulesFn = createServerFn({ method: 'POST' })
  .validator(reorderGuidanceRulesSchema)
  .handler(async ({ data }) => {
    log.info('reorder guidance rules')
    try {
      await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { reorderGuidanceRules } = await import(
        '@/lib/server/domains/assistant/guidance.service'
      )
      await reorderGuidanceRules(data.ids as AssistantGuidanceRuleId[])
      return { ids: data.ids }
    } catch (error) {
      log.error({ err: error }, 'reorder guidance rules failed')
      throw error
    }
  })

export const deleteGuidanceRuleFn = createServerFn({ method: 'POST' })
  .validator(deleteGuidanceRuleSchema)
  .handler(async ({ data }) => {
    log.info('delete guidance rule')
    try {
      await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { deleteGuidanceRule } = await import('@/lib/server/domains/assistant/guidance.service')
      await deleteGuidanceRule(data.id as AssistantGuidanceRuleId)
      return { id: data.id }
    } catch (error) {
      log.error({ err: error }, 'delete guidance rule failed')
      throw error
    }
  })

/** The controllable shape of a tool spec — everything the settings UI needs, nothing model-facing. */
export interface AssistantToolSummary {
  name: string
  label: string
  description: string
  risk: 'read' | 'write'
  supportedModes: readonly ('disabled' | 'approval' | 'autonomous')[]
  defaultMode: 'disabled' | 'approval' | 'autonomous'
}

/** The resolved tool catalogue (built-ins plus enabled connectors), projected for the settings UI. */
export const listAssistantToolsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list assistant tools')
  try {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { resolveToolSpecs } = await import('@/lib/server/domains/assistant/assistant.toolspec')
    const specs = await resolveToolSpecs()
    return specs.map(
      (spec): AssistantToolSummary => ({
        name: spec.name,
        label: spec.label,
        description: spec.description,
        risk: spec.risk,
        supportedModes: spec.supportedModes,
        defaultMode: spec.defaultMode,
      })
    )
  } catch (error) {
    log.error({ err: error }, 'list assistant tools failed')
    throw error
  }
})
