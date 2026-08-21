import type { PlgEventInput } from '@/lib/shared/plg-events'

/** Best-effort by design: activation must never wait for product analytics. */
export function recordPlgEvent(event: PlgEventInput): void {
  void fetch('/api/plg-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {})
}
