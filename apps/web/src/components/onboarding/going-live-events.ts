import { useCallback } from 'react'

/** The going-live sheets the admin layout hosts. */
export type GoingLiveSheet = 'invite-team'

/**
 * The event that opens one of the admin's going-live sheets. An event, rather
 * than a context, keeps the sheets' code out of every page that offers them:
 * the admin layout listens and loads a sheet on its first open.
 */
export const OPEN_GOING_LIVE_EVENT = 'quackback:open-going-live'

export function openGoingLiveSheet(sheet: GoingLiveSheet): void {
  window.dispatchEvent(new CustomEvent(OPEN_GOING_LIVE_EVENT, { detail: sheet }))
}

export function useOpenGoingLiveSheet(): (sheet: GoingLiveSheet) => void {
  return useCallback((sheet: GoingLiveSheet) => openGoingLiveSheet(sheet), [])
}
