/**
 * Server functions for macros (support platform §4.6): the admin manager's CRUD
 * and the composer's read + apply. Authoring reuses conversation.manage (the
 * gate the old canned replies used); reading + applying reuses
 * conversation.reply. No new permission keys.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { MacroId, ConversationId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import {
  listMacros,
  getMacro,
  createMacro,
  updateMacro,
  deleteMacro,
  buildMacroContext,
  renderMacro,
  applyMacroActions,
} from '@/lib/server/domains/macros'

const log = logger.child({ component: 'macros-fn' })

const macroScopeSchema = z.enum(['support', 'feedback', 'both'])

/** The bundled-action union, validated on write (mirrors the schema type). */
const macroActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_agent'), principalId: z.string().min(1) }),
  z.object({ type: z.literal('assign_team'), teamId: z.string().min(1) }),
  z.object({ type: z.literal('add_tag'), tagId: z.string().min(1) }),
  z.object({
    type: z.literal('set_priority'),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  }),
  z.object({ type: z.literal('snooze'), preset: z.enum(['until_reply', 'tomorrow', 'next_week']) }),
  z.object({ type: z.literal('close') }),
  z.object({
    type: z.literal('set_attribute'),
    key: z.string().min(1).max(80),
    // The JSON value shapes per field type; validation AGAINST the definition
    // (option ids, number finiteness) happens in the domain writer at apply.
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  }),
])

const listMacrosSchema = z
  .object({ surface: z.enum(['support', 'feedback']).optional() })
  .optional()

// A teammate hand-types both fields from the macro manager form, so these
// stay tight.
const MACRO_NAME_MAX = 80
const MACRO_BODY_MAX = 4000

const createMacroSchema = z.object({
  name: z.string().min(1).max(MACRO_NAME_MAX),
  body: z.string().min(1).max(MACRO_BODY_MAX),
  scope: macroScopeSchema.default('support'),
  actions: z.array(macroActionSchema).max(20).default([]),
})

const updateMacroSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(MACRO_NAME_MAX).optional(),
  body: z.string().min(1).max(MACRO_BODY_MAX).optional(),
  scope: macroScopeSchema.optional(),
  actions: z.array(macroActionSchema).max(20).optional(),
})

const deleteMacroSchema = z.object({ id: z.string() })

const applyMacroSchema = z.object({ conversationId: z.string(), macroId: z.string() })

/** All macros (manager) or the ones a surface offers (composer picker). */
export const listMacrosFn = createServerFn({ method: 'GET' })
  .validator(listMacrosSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    return { macros: await listMacros(data?.surface) }
  })

export const createMacroFn = createServerFn({ method: 'POST' })
  .validator(createMacroSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return createMacro({
      name: data.name.trim(),
      body: data.body,
      scope: data.scope,
      actions: data.actions,
      createdByPrincipalId: ctx.principal.id,
    })
  })

export const updateMacroFn = createServerFn({ method: 'POST' })
  .validator(updateMacroSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return updateMacro(data.id as MacroId, {
      name: data.name?.trim(),
      body: data.body,
      scope: data.scope,
      actions: data.actions,
    })
  })

export const deleteMacroFn = createServerFn({ method: 'POST' })
  .validator(deleteMacroSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    await deleteMacro(data.id as MacroId)
    return { id: data.id as MacroId }
  })

/**
 * Render a macro against a live conversation and run its bundled actions. The
 * composer inserts the returned body; actions are applied here (on use, not on
 * send) and their labels come back for the confirmation toast.
 */
export const applyMacroFn = createServerFn({ method: 'POST' })
  .validator(applyMacroSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
      const actor = await policyActorFromAuth(ctx)
      const conversationId = data.conversationId as ConversationId
      // Independent reads: fetch the macro and build the render context together.
      const [macro, context] = await Promise.all([
        getMacro(data.macroId as MacroId),
        buildMacroContext(conversationId),
      ])
      const body = renderMacro(macro.body, context)
      const applied = await applyMacroActions(conversationId, macro.actions, actor)
      return { body, applied }
    } catch (error) {
      log.error({ err: error }, 'apply macro failed')
      throw error
    }
  })
