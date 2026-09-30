/**
 * The viewport at which the inbox detail panel exists at all, bound to the
 * `xl:` Tailwind breakpoint on the panel's own `hidden xl:flex` <aside>. The
 * inbox route derives `copilotAvailable` from the SAME query so the Ask
 * Copilot affordances can never disagree with the panel actually rendering,
 * and the thread request only loads the panel's reads where it shows.
 */
export const DETAIL_PANEL_MEDIA_QUERY = '(min-width: 1280px)'

/** Whether the detail panel shows. A server render cannot know, so it assumes it does. */
export function isDetailPanelShown(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return true
  return globalThis.matchMedia(DETAIL_PANEL_MEDIA_QUERY).matches
}
