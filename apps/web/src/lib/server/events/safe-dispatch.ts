/**
 * Best-effort wrapper for webhook / event-bus dispatch. A failure must never
 * break the write that triggered it (tickets and conversations share this
 * contract).
 */
type WarnLogger = {
  warn: (obj: Record<string, unknown>, msg: string) => void
}

export function makeSafeDispatch(log: WarnLogger) {
  return async function safe(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      log.warn({ err, label }, 'webhook failed')
    }
  }
}
