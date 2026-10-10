import { HomeGettingStarted, HomeTourOffer } from './home-launch-plan'

/** Home's first-run area: the first win and the launch plan. */
export function HomeLaunchArea({ portalUrl, member }: { portalUrl?: string; member?: boolean }) {
  return <HomeGettingStarted portalUrl={portalUrl} member={member} />
}

/** Home's last block in the first run: the tour offer. */
export function HomeTourArea({ member }: { member?: boolean }) {
  return <HomeTourOffer member={member} />
}
