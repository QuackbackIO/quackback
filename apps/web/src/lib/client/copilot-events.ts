/**
 * Fire-and-forget client seam for Copilot usage events (inserts + thumbs
 * feedback), wrapping `recordCopilotEventFn`. Logging must NEVER block or
 * break the insert/feedback UI, so every failure is swallowed here — call
 * sites just fire and move on. The input shape is re-exported from its owner
 * (the server fn module), never retyped here.
 */
import { recordCopilotEventFn, type CopilotEventInput } from '@/lib/server/functions/copilot-events'

export type { CopilotEventInput }

export function recordCopilotEvent(input: CopilotEventInput): void {
  void recordCopilotEventFn({ data: input }).catch(() => {})
}
