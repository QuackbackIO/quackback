/**
 * A ship moment: a team member just marked a post complete or published a
 * changelog entry. The GitHub star prompt listens for it, so the one-time ask
 * follows their own good news instead of arriving on page load. The post and
 * changelog mutations dispatch this event inline under the same name.
 */
export const SHIP_MOMENT_EVENT = 'quackback:ship-moment'

export function announceShipMoment(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SHIP_MOMENT_EVENT))
}

export function onShipMoment(listener: () => void): () => void {
  window.addEventListener(SHIP_MOMENT_EVENT, listener)
  return () => window.removeEventListener(SHIP_MOMENT_EVENT, listener)
}
