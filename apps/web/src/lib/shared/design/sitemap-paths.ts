import { portalLanding, type PortalPageGates, type PortalPathSettings } from './paths'

/**
 * The feedback pages a sitemap lists: the root unless it only redirects, the
 * feed at its one address, and the roadmap. Other pages list themselves.
 */
export function portalSitemapPaths(settings: PortalPathSettings, gates: PortalPageGates): string[] {
  const landing = portalLanding(settings, gates)
  const paths: string[] = []
  if (landing.kind === 'home' || (landing.kind === 'feed' && gates.feedback)) paths.push('/')
  if (gates.feedback) {
    if (landing.kind !== 'feed') paths.push('/feedback')
    paths.push('/roadmap')
  }
  return paths
}
