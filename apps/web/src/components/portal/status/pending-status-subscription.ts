/**
 * A status subscription a signed-out visitor asked for, held across sign-in.
 *
 * Subscribing needs an account, so the Subscribe button sends a signed-out
 * visitor through the portal's sign-in flow first. That flow can leave the
 * page (an SSO redirect returns to it later) or finish in another tab (a
 * magic link opened from the email), so the chosen scope is kept in
 * localStorage, which both survive. It is completed only by a sign-in that
 * came from the subscribe flow: one that finishes in the dialog, or a return
 * through the sign-in callback URL, which carries {@link RESUME_PARAM}. A
 * visitor who closes the dialog and signs in some other way later is never
 * subscribed by surprise, and the choice expires after half an hour.
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

/** Marks the sign-in callback URL as a return from subscribing. */
export const RESUME_PARAM = 'subscribe'
const RESUME_VALUE = 'resume'

/** This page's URL, marked as the place a subscribe sign-in returns to. */
export function resumeSubscribeUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set(RESUME_PARAM, RESUME_VALUE)
  return url.pathname + url.search
}

/** Whether this page was reached by returning from a subscribe sign-in. The
 *  marker is removed from the address bar as it is read. */
export function takeResumeMarker(): boolean {
  const url = new URL(window.location.href)
  if (url.searchParams.get(RESUME_PARAM) !== RESUME_VALUE) return false
  url.searchParams.delete(RESUME_PARAM)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  return true
}
