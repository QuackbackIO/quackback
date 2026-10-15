import { redirect } from '@tanstack/react-router'

/**
 * Send a visitor of a retired admin URL to the page that took its place. The
 * query string travels with the visit, so a bookmark such as `?tab=guidance`
 * or an OAuth return keeps its meaning.
 */
export function redirectMoved(to: string, location: { searchStr?: string }): never {
  const [path, targetSearch] = to.split('?')
  const query = new URLSearchParams(location.searchStr)
  for (const [key, value] of new URLSearchParams(targetSearch)) query.set(key, value)
  const search = query.toString()
  throw redirect({ href: `${path}${search ? `?${search}` : ''}`, replace: true })
}
