/**
 * Changelog audience gate (Changelog Settings §2 Visibility card):
 * `audience: 'public' | 'authenticated'` restricts the whole public
 * changelog (list, detail, RSS feed, widget tab) to signed-in portal users
 * when set to 'authenticated'. Team members always pass.
 *
 * Every surface that shows or announces a changelog entry asks the same
 * question, in one of three forms:
 *   - a request (portal, widget, embed): the portal gate for the caller
 *     (`resolvePortalAccessForRequest`), then {@link isChangelogOpenTo};
 *   - nobody in particular (sitemap, the customer assistant):
 *     {@link isChangelogOpenToAnonymous};
 *   - announcement recipients (email, bell): `principalsWithPortalAccess`,
 *     then {@link isChangelogOpenTo} for each.
 * Each entry's own label gate (`categoryGateAllows`) applies on top.
 */
import { ANONYMOUS_ACTOR, isTeamActor, type Actor } from '@/lib/server/policy/types'
import { getChangelogSettings } from '@/lib/server/domains/settings/settings.changelog'
import { getPortalConfig, isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { NotFoundError } from '@/lib/shared/errors'

/** The audience rule on an audience already read: 'authenticated' lets in
 *  the team and signed-in people only. For a fan-out, which reads the
 *  settings once rather than per recipient. */
export function isAudienceOpenTo(audience: string | undefined, actor: Actor): boolean {
  if (audience !== 'authenticated') return true
  if (isTeamActor(actor)) return true
  return actor.principalType === 'user'
}

export async function isChangelogAudienceGranted(actor: Actor): Promise<boolean> {
  const { audience } = await getChangelogSettings()
  return isAudienceOpenTo(audience, actor)
}

/** The Changelog product is on and its audience lets `actor` in. */
export async function isChangelogOpenTo(actor: Actor): Promise<boolean> {
  if (!(await isFeatureEnabled('changelog'))) return false
  return isChangelogAudienceGranted(actor)
}

/** Whether a reader with no session (a crawler, the customer assistant) may
 *  read the changelog: the portal is not private and the changelog is open to
 *  an anonymous visitor. */
export async function isChangelogOpenToAnonymous(): Promise<boolean> {
  try {
    const portal = await getPortalConfig()
    if (portal.access?.visibility === 'private') return false
  } catch (err) {
    // No settings row yet: an un-onboarded install is public, as the portal
    // gate treats it. Anything else fails closed.
    if (!(err instanceof NotFoundError)) return false
  }
  return isChangelogOpenTo(ANONYMOUS_ACTOR)
}
