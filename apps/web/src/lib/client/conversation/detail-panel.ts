/**
 * The viewport at which the inbox detail panel exists at all, bound to the
 * `min-[1680px]:` breakpoint on the panel's own `hidden min-[1680px]:flex`
 * <aside>. Below it the thread header's Details button opens the same panel
 * in a sheet. The
 * inbox route derives `copilotAvailable` from the SAME query so the Ask
 * Copilot affordances can never disagree with the panel actually rendering,
 * and the thread request only loads the panel's reads where it shows.
 */
export const DETAIL_PANEL_MEDIA_QUERY = '(min-width: 1680px)'

/** Whether the detail panel shows. A server render cannot know, so it assumes it does. */
export function isDetailPanelShown(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return true
  return globalThis.matchMedia(DETAIL_PANEL_MEDIA_QUERY).matches
}
