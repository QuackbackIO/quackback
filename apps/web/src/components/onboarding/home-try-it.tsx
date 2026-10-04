import { HomeGettingStarted } from './home-launch-plan'

/** Home's first-run area. The test actions live in the steps they complete. */
export function HomeLaunchArea({ portalUrl }: { portalUrl?: string }) {
  return <HomeGettingStarted portalUrl={portalUrl} />
}
