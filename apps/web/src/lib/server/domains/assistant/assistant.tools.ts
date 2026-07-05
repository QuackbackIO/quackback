/**
 * Quinn's v1 tool layer: assembles the tool catalogue (assistant.toolspec.ts)
 * into TanStack AI server tools bound to a runtime context.
 *
 * Control-mode gating, permission checks, and approval/audit wiring live on
 * the catalogue entries but are not enforced here yet — that lands in a later
 * task. Today every spec in the catalogue runs unconditionally, which is
 * exactly the two read tools that existed before the catalogue: structurally
 * gated with typed zod inputs, allowlisted output fields, and a runtime
 * context that never reaches the model.
 */
import type { AssistantToolContext } from './assistant.toolspec'
import { resolveToolSpecs } from './assistant.toolspec'

/** Build the server-side tool set bound to a runtime context. */
export function createAssistantTools() {
  return resolveToolSpecs().map((spec) =>
    spec.definition.server<AssistantToolContext>((args, toolCtx) => spec.execute(args, toolCtx.context))
  )
}
