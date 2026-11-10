/**
 * The loop's tools, as the model calls them: one structured answer per step
 * whose fields are the calls (apply_ops, set styles, verify, get_styles,
 * read_website, match_website, finish), each list's shape generated from the style registry, so the
 * token system's registry changes what the model may name without touching
 * the loop. One structured answer per step, rather than native tool calls,
 * because a provider's JSON schema mode suppresses tool calls when both are
 * on (see the TanStack AI notes), and a flat answer keeps the grammar small.
 */
import { z } from 'zod'
import { OP_KINDS } from '../design-ops'
import { EXPECTS } from './verify'
import type { StyleRegistry, StyleStateId } from './style-registry'

const ids = <T extends string>(list: readonly { id: T }[]) =>
  list.map((each) => each.id) as [T, ...T[]]

/** The answer schema for one step, its enums from the registry. */
export function agentStepSchema(registry: StyleRegistry) {
  const element = z.enum(ids(registry.elements))
  const state = z.enum(ids(registry.states) as [StyleStateId, ...StyleStateId[]])
  const property = z.enum(ids(registry.properties))
  return z.object({
    /** What this step does and why, in one sentence: the plan, or the correction. */
    plan: z.string().max(300),
    /** apply_ops: today's operations (set, theme, words, add, move, resize, remove, menu). */
    ops: z
      .array(
        z.object({
          op: z.enum(OP_KINDS),
          target: z.string().max(160),
          key: z.string().max(80),
          value: z.string().max(4000),
          says: z.string().max(160),
        })
      )
      .max(16),
    /** apply_ops for styles: an element in a state, a property, a value. */
    styles: z
      .array(
        z.object({
          element,
          state,
          /** A Home block's type to style only that block, or "". */
          block: z.string().max(40),
          property,
          value: z.string().max(120),
          says: z.string().max(160),
        })
      )
      .max(16),
    /** verify: what the drawn page must show once this step's changes are in. */
    checks: z
      .array(
        z.object({
          element,
          state,
          block: z.string().max(40),
          /** Where an override went (part:<id>, page:<page>, block:<id>), or "" for the site's look. */
          target: z.string().max(160),
          property,
          expect: z.enum(EXPECTS),
          value: z.string().max(60),
        })
      )
      .max(12),
    /** get_styles: elements to read as drawn, for the next step. */
    read: z.array(z.object({ element, state, block: z.string().max(40) })).max(6),
    /** A small picture of the page after this step, for a look described by feel or a picture. */
    look: z.boolean(),
    /** read_website: a site's address to read (facts and a capture), or "". */
    read_website: z.string().max(300),
    /** match_website: a site's address to match the portal to, once read, or "". */
    match_website: z.string().max(300),
    /** finish: true when this step completes the request. */
    done: z.boolean(),
    /** The reply to the person when done: what changed, said as done. */
    reply: z.string().max(600),
  })
}

export type AgentStepAnswer = z.infer<ReturnType<typeof agentStepSchema>>
