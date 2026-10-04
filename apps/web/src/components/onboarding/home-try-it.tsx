import { HomeGettingStarted } from './home-launch-plan'

/** Home's first-run area. The test actions live in the steps they complete. */
export function HomeLaunchArea({ portalUrl, member }: { portalUrl?: string; member?: boolean }) {
  return <HomeGettingStarted portalUrl={portalUrl} member={member} />
}
