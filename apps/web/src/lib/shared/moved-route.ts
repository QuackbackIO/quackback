import { redirect } from '@tanstack/react-router'

/**
 * Send a visitor of a retired admin URL to the page that took its place. The
 * query string travels with the visit, so a bookmark such as `?tab=guidance`
 * or an OAuth return keeps its meaning.
 */
export function redirectMoved(to: string, location: { searchStr?: string }): never {
  throw redirect({ href: `${to}${location.searchStr ?? ''}`, replace: true })
}
