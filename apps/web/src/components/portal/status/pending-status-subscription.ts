/**
 * A status subscription a signed-out visitor asked for, held across sign-in.
 *
 * Subscribing needs an account, so the Subscribe button sends a signed-out
 * visitor through the portal's sign-in flow first. That flow can leave the
 * page (an SSO redirect returns to it later) or finish in another tab (a
 * magic link opened from the email), so the chosen scope is kept in
 * localStorage, which both survive, and the button completes the
 * subscription once it sees a signed-in visitor. It expires so a sign-in
 * long after an abandoned attempt doesn't subscribe anyone by surprise.
 */
import type { StatusComponentId } from '@quackback/ids'

const STORAGE_KEY = 'quackback:pending-status-subscription'
const MAX_AGE_MS = 30 * 60 * 1000

export interface PendingStatusSubscription {
  scope: 'page' | 'components'
  componentIds: StatusComponentId[]
}

export function savePendingStatusSubscription(pending: PendingStatusSubscription): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pending, savedAt: Date.now() }))
  } catch {
    // Storage unavailable (private mode, quota): the visitor subscribes again by hand.
  }
}

/** The pending subscription, removed as it is read; null when there is none
 *  or it has expired. */
export function takePendingStatusSubscription(): PendingStatusSubscription | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingStatusSubscription> & { savedAt?: unknown }
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) return null
    if (parsed.scope === 'page') return { scope: 'page', componentIds: [] }
    if (
      parsed.scope === 'components' &&
      Array.isArray(parsed.componentIds) &&
      parsed.componentIds.length > 0 &&
      parsed.componentIds.every((id) => typeof id === 'string')
    ) {
      return { scope: 'components', componentIds: parsed.componentIds }
    }
  } catch {
    // Not ours, or corrupted: drop it.
  }
  return null
}
