/**
 * Custom-action library CRUD + a test-run server fn for the Quinn Actions tab
 * (QUINN-TWO-AGENT-SPEC D6/Phase 5). All gate on assistant.manage, same as
 * assistant-guidance.ts, and emit `assistant.custom_action.*` audit events onto
 * the shared AI config changelog. Secret header values never round-trip to the
 * client: the DTO masks them, and only a value the user actually retyped
 * overwrites the stored ciphertext (the service handles both).
 *
 * The test fn runs the request server-side through the SAME
 * `performActionRequest` seam the model runtime uses and returns the ALLOWLISTED
 * response, so the admin sees exactly what the model would see.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { AssistantCustomActionId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  assistantActionInputSchema,
  assistantActionRequestSchema,
  assistantActionAllowlistPathSchema,
  assistantActionResponseCharLimitSchema,
  type AssistantActionDTO,
} from '@/lib/shared/assistant/custom-actions'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-custom-actions' })

const updateCustomActionSchema = assistantActionInputSchema.extend({ id: z.string() })
const deleteCustomActionSchema = z.object({ id: z.string() })

/**
 * Test-run input: the request as edited in the form (secret header values in
 * plaintext as typed, or empty to reuse a saved secret when `id` is given),
 * plus sample variable values and the allowlist/char-cap to scope the result.
 */
const testCustomActionSchema = z.object({
  id: z.string().optional(),
  request: assistantActionRequestSchema,
  variables: z.record(z.string(), z.string()),
  responseAllowlist: z.array(assistantActionAllowlistPathSchema),
  responseCharLimit: assistantActionResponseCharLimitSchema,
})

export const listCustomActionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list custom actions')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { listCustomActions, toActionDTO } =
    await import('@/lib/server/domains/assistant/custom-actions.service')
  const rows = await listCustomActions()
  return { actions: rows.map(toActionDTO) satisfies AssistantActionDTO[] }
})

export const createCustomActionFn = createServerFn({ method: 'POST' })
  .validator(assistantActionInputSchema)
  .handler(async ({ data }) => {
    log.info('create custom action')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { createCustomAction, toActionDTO } =
      await import('@/lib/server/domains/assistant/custom-actions.service')
    const row = await createCustomAction({ ...data, createdById: ctx.principal.id })
    await recordAuditEvent({
      event: 'assistant.custom_action.created',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_custom_action', id: row.id },
      after: {
        name: row.name,
        method: row.method,
        enabled: row.enabled,
        assignments: row.assignments,
      },
    })
    return toActionDTO(row)
  })

export const updateCustomActionFn = createServerFn({ method: 'POST' })
  .validator(updateCustomActionSchema)
  .handler(async ({ data }) => {
    log.info('update custom action')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateCustomAction, toActionDTO } =
      await import('@/lib/server/domains/assistant/custom-actions.service')
    const { id, ...input } = data
    const row = await updateCustomAction(id as AssistantCustomActionId, input)
    await recordAuditEvent({
      event: 'assistant.custom_action.updated',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_custom_action', id },
      after: row
        ? {
            name: row.name,
            method: row.method,
            enabled: row.enabled,
            assignments: row.assignments,
          }
        : null,
    })
    return row ? toActionDTO(row) : null
  })

export const deleteCustomActionFn = createServerFn({ method: 'POST' })
  .validator(deleteCustomActionSchema)
  .handler(async ({ data }) => {
    log.info('delete custom action')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteCustomAction } =
      await import('@/lib/server/domains/assistant/custom-actions.service')
    await deleteCustomAction(data.id as AssistantCustomActionId)
    await recordAuditEvent({
      event: 'assistant.custom_action.deleted',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_custom_action', id: data.id },
    })
    return { id: data.id }
  })

export interface CustomActionTestResult {
  ok: boolean
  httpStatus?: number
  data: string
  note?: string
  truncated?: boolean
}

/**
 * Test-run a custom action server-side and return the allowlisted result.
 *
 * Trusted-role reality (accepted): this is gated on `assistant.manage`, and an
 * admin who holds it can already point a saved action's URL at a host they
 * control and Test it — the server decrypts the stored secret headers and sends
 * them there. So the masked-secret DTO (`toActionDTO` never returns a secret's
 * plaintext) is UI hygiene against shoulder-surfing and casual leakage, NOT a
 * confidentiality boundary against the `assistant.manage` role itself. Guarding
 * against that role exfiltrating its own workspace's secrets is out of scope by
 * design; the boundary is who holds `assistant.manage`, not this fn.
 */
export const testCustomActionFn = createServerFn({ method: 'POST' })
  .validator(testCustomActionSchema)
  .handler(async ({ data }): Promise<CustomActionTestResult> => {
    log.info('test custom action')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { performActionRequest, getCustomAction } =
      await import('@/lib/server/domains/assistant/custom-actions.service')
    const { decrypt } = await import('@/lib/server/encryption')

    // Resolve the header values to send: a non-secret header uses its typed
    // value; a secret header uses the typed value if the user retyped one,
    // otherwise the stored ciphertext for the saved action (decrypted here).
    const savedSecrets = new Map<string, string>()
    if (data.id) {
      const existing = await getCustomAction(data.id as AssistantCustomActionId)
      for (const header of existing?.headers ?? []) {
        if (header.secret && header.value.length > 0) {
          try {
            savedSecrets.set(header.name, decrypt(header.value, 'assistant-custom-action-headers'))
          } catch {
            // A key rotation / corrupt value: skip, the test simply omits it.
          }
        }
      }
    }
    const headers: Record<string, string> = {}
    for (const header of data.request.headers) {
      if (!header.secret) {
        headers[header.name] = header.value
      } else if (header.value.length > 0) {
        headers[header.name] = header.value
      } else if (savedSecrets.has(header.name)) {
        headers[header.name] = savedSecrets.get(header.name)!
      }
    }

    const result = await performActionRequest({
      method: data.request.method,
      url: data.request.url,
      headers,
      body: data.request.body ?? null,
      variables: data.variables,
      responseAllowlist: data.responseAllowlist,
      responseCharLimit: data.responseCharLimit,
    })
    return {
      ok: result.ok,
      httpStatus: result.httpStatus,
      data: result.data,
      note: result.note,
      truncated: result.truncated,
    }
  })
