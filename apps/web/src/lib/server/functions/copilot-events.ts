/**
 * Copilot usage events (outcome loop): the panel's fire-and-forget writer for
 * "an answer was actually used" and per-answer thumbs feedback — the outcomes
 * half of the Copilot usage report (analytics/copilot-usage.ts), which until
 * this fn only had the adoption half (questions/transforms/summaries run).
 *
 * One append-only `assistant_events` row per call. Deliberately NOT
 * idempotent: the client fires this after a UI gesture and never awaits or
 * retries it, so a double-click double-counts — acceptable for a trend report,
 * and cheaper than threading an idempotency key through every insert
 * affordance. Shape rules live in the schema, not the handler: a `feedback`
 * event requires a rating and nothing else may carry one; every `*_inserted`
 * event requires a `destination` ('reply' | 'note' — where the text landed)
 * and `feedback` may not carry one. An insert event's other qualifiers are
 * `answerType`/`internalSourced`, both optional (an aborted turn reports
 * neither) and stored only when present.
 *
 * Gated through `gateCopilotFn` (copilot-gate.ts, shared with
 * copilot-summary.ts). The item ref is the same union the copilot SSE route
 * parses (item-ref.schema.ts's `withAssistantItemRef`), nested under `item`
 * since this fn has its own top-level fields alongside it.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { db, assistantEvents } from '@/lib/server/db'
import { gateCopilotFn, CopilotUnavailableError } from '@/lib/server/domains/assistant/copilot-gate'
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
import {
  COPILOT_EVENT_TYPES,
  COPILOT_INSERT_DESTINATIONS,
} from '@/lib/shared/assistant/copilot-contract'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'copilot-events-fn' })

const recordCopilotEventSchema = z
  .object({
    /** Exactly one of `{ conversationId }` or `{ ticketId }` — the same union
     *  the copilot route parses, see item-ref.schema.ts. */
    item: withAssistantItemRef({}),
    eventType: z.enum(COPILOT_EVENT_TYPES),
    /** Where an inserted event landed (reply composer vs internal note) —
     *  required on every `*_inserted` kind, rejected on `feedback`; the
     *  superRefine below enforces both halves. */
    destination: z.enum(COPILOT_INSERT_DESTINATIONS).optional(),
    rating: z.enum(['up', 'down']).optional(),
    reason: z.string().max(500).optional(),
    answerType: z.enum(['draft_reply', 'analysis']).optional(),
    /** Optional even on an inserted event: an unfinalized (aborted) turn has
     *  no server-derived leak-gate signal to report, and the handler stores
     *  the field only when present — never coerced to false. */
    internalSourced: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.eventType === 'feedback' && !value.rating) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rating'],
        message: 'A feedback event requires a rating',
      })
    }
    if (value.eventType !== 'feedback' && value.rating) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rating'],
        message: 'Only a feedback event may carry a rating',
      })
    }
    if (value.eventType !== 'feedback' && !value.destination) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination'],
        message: 'An inserted event requires a destination',
      })
    }
    if (value.eventType === 'feedback' && value.destination) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination'],
        message: 'A feedback event may not carry a destination',
      })
    }
  })

/** The fn's request contract, for the client seam to build calls against
 *  (lib/client/copilot-events.ts) without hand-mirroring the schema. */
export type CopilotEventInput = z.input<typeof recordCopilotEventSchema>

export const recordCopilotEventFn = createServerFn({ method: 'POST' })
  .validator(recordCopilotEventSchema)
  .handler(async ({ data }) => {
    try {
      const { auth, conversationId, ticketId } = await gateCopilotFn(data.item)

      await db.insert(assistantEvents).values({
        eventType: data.eventType,
        principalId: auth.principal.id,
        conversationId,
        ticketId,
        metadata: {
          ...(data.destination !== undefined && { destination: data.destination }),
          ...(data.rating !== undefined && { rating: data.rating }),
          ...(data.reason !== undefined && { reason: data.reason }),
          ...(data.answerType !== undefined && { answerType: data.answerType }),
          ...(data.internalSourced !== undefined && { internalSourced: data.internalSourced }),
        },
      })

      return { ok: true as const }
    } catch (error) {
      // An expected denial (no copilot.use, flag off / unconfigured, item not
      // viewable) is the gate doing its job on a fire-and-forget telemetry
      // write — debug, not error; log.error is reserved for failures nobody
      // designed for (db down, session store broken).
      if (
        isAuthDenialError(error) ||
        error instanceof CopilotUnavailableError ||
        error instanceof NotFoundError
      ) {
        log.debug({ err: error }, 'copilot usage event denied by gate')
      } else {
        log.error({ err: error }, 'recording copilot usage event failed')
      }
      throw error
    }
  })
