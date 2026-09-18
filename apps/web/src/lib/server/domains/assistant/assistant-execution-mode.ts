/**
 * How automatic customer turns execute, and the rollback switch.
 *
 * `durable` (the default) persists a run intent and a queue job in the same
 * transaction as the customer's message, then publishes behind the fences in
 * assistant-run.service.ts. `legacy` is the rollback position: the historical
 * post-commit fire-and-forget call, writing no run rows at all.
 *
 * Read from `process.env` directly rather than through the zod config, matching
 * `process-role.ts`: the decision is made in the web tier AND in a worker that
 * may never have loaded the full application config. An unrecognised value
 * falls back to `durable` with a warning, because that is the path that cannot
 * silently lose an accepted customer message.
 *
 * A leaf module on purpose. Both the conversation intake and the queue handler
 * need this answer, and neither should have to import the other to get it.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-execution-mode' })

export const ASSISTANT_EXECUTION_MODES = ['legacy', 'durable'] as const
export type AssistantExecutionMode = (typeof ASSISTANT_EXECUTION_MODES)[number]

let warned = false

export function assistantExecutionMode(): AssistantExecutionMode {
  const raw = process.env.ASSISTANT_EXECUTION_MODE?.trim().toLowerCase()
  if (!raw) return 'durable'
  if (raw === 'legacy' || raw === 'durable') return raw
  if (!warned) {
    warned = true
    log.warn(
      { ASSISTANT_EXECUTION_MODE: process.env.ASSISTANT_EXECUTION_MODE },
      'unrecognised assistant execution mode, using durable'
    )
  }
  return 'durable'
}

/** Test seam: the warning is once-per-process, so a suite that flips the env resets it. */
export function __resetExecutionModeWarningForTests(): void {
  warned = false
}
