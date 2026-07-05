/**
 * Server functions for workflows (support platform §4.6): the AI & Automation
 * manager's CRUD + lifecycle. Reads stay on routing.manage (workflows are part of
 * the routing surface); mutations gate on the dedicated workflow.manage key. Graph
 * + trigger settings are validated on write via the shared schemas so a malformed
 * automation is rejected at the boundary rather than stored and silently no-op'd
 * by the engine. Returns JSON-safe DTOs (Dates -> ISO, ids as plain strings), the
 * shape server functions serialize.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { WorkflowId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Workflow, WorkflowClass, WorkflowStatus } from '@/lib/server/db'
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  setWorkflowStatus,
  softDeleteWorkflow,
} from '@/lib/server/domains/workflows/workflow.service'
import type { WorkflowGraph } from '@/lib/server/domains/workflows/graph'
import {
  workflowGraphSchema,
  triggerSettingsSchema,
  type ValidatedWorkflowGraph,
} from '@/lib/server/domains/workflows/workflow.schemas'

// createServerFn constrains returns to serializable types, so the jsonb fields
// are typed as JSON (not Record<string, unknown> — `unknown` isn't provably
// serializable). The stored jsonb is JSON at runtime, so the cast is safe.
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
type JsonObject = { [k: string]: JsonValue }

export interface WorkflowDTO {
  id: string
  name: string
  class: WorkflowClass
  status: WorkflowStatus
  sortOrder: number
  triggerType: string
  triggerSettings: JsonObject
  graph: JsonObject
  createdBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function serializeWorkflow(w: Workflow): WorkflowDTO {
  return {
    id: w.id,
    name: w.name,
    class: w.class,
    status: w.status,
    sortOrder: w.sortOrder,
    triggerType: w.triggerType,
    triggerSettings: w.triggerSettings as JsonObject,
    graph: w.graph as JsonObject,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    deletedAt: w.deletedAt ? w.deletedAt.toISOString() : null,
  }
}

/** The validated graph carries plain-string ids; the branded WorkflowGraph is
 *  satisfied by them at runtime (validation already fixed the shape). */
const toGraph = (g: ValidatedWorkflowGraph | undefined): WorkflowGraph | undefined =>
  g as WorkflowGraph | undefined

const workflowClass = z.enum(['customer_facing', 'background'])
const createSchema = z.object({
  name: z.string().min(1).max(120),
  class: workflowClass,
  triggerType: z.string().min(1).max(80),
  triggerSettings: triggerSettingsSchema.optional(),
  graph: workflowGraphSchema.optional(),
  sortOrder: z.number().int().optional(),
})
const updateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  class: workflowClass.optional(),
  triggerType: z.string().min(1).max(80).optional(),
  triggerSettings: triggerSettingsSchema.optional(),
  graph: workflowGraphSchema.optional(),
  sortOrder: z.number().int().optional(),
})
const setStatusSchema = z.object({ id: z.string(), status: z.enum(['draft', 'live', 'paused']) })
const idSchema = z.object({ id: z.string() })

export const listWorkflowsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
  return (await listWorkflows()).map(serializeWorkflow)
})

export const getWorkflowFn = createServerFn({ method: 'GET' })
  .validator(idSchema)
  .handler(async ({ data }): Promise<WorkflowDTO | null> => {
    await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
    const wf = await getWorkflow(data.id as WorkflowId)
    return wf ? serializeWorkflow(wf) : null
  })

export const createWorkflowFn = createServerFn({ method: 'POST' })
  .validator(createSchema)
  .handler(async ({ data }): Promise<WorkflowDTO> => {
    const ctx = await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    return serializeWorkflow(
      await createWorkflow({
        name: data.name,
        class: data.class,
        triggerType: data.triggerType,
        triggerSettings: data.triggerSettings,
        graph: toGraph(data.graph),
        sortOrder: data.sortOrder,
        createdBy: ctx.principal.id,
      })
    )
  })

export const updateWorkflowFn = createServerFn({ method: 'POST' })
  .validator(updateSchema)
  .handler(async ({ data }): Promise<WorkflowDTO> => {
    await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    return serializeWorkflow(
      await updateWorkflow(data.id as WorkflowId, {
        name: data.name,
        class: data.class,
        triggerType: data.triggerType,
        triggerSettings: data.triggerSettings,
        graph: toGraph(data.graph),
        sortOrder: data.sortOrder,
      })
    )
  })

export const setWorkflowStatusFn = createServerFn({ method: 'POST' })
  .validator(setStatusSchema)
  .handler(async ({ data }): Promise<WorkflowDTO> => {
    await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    return serializeWorkflow(await setWorkflowStatus(data.id as WorkflowId, data.status))
  })

export const deleteWorkflowFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    await requireAuth({ permission: PERMISSIONS.WORKFLOW_MANAGE })
    await softDeleteWorkflow(data.id as WorkflowId)
    return { id: data.id }
  })
