/**
 * Changelog audience gate (Changelog Settings §2 Visibility card):
 * `audience: 'public' | 'authenticated'` restricts the whole public
 * changelog (list, detail, RSS feed, widget tab) to signed-in portal users
 * when set to 'authenticated'. Team members always pass.
 */
import { isTeamActor, type Actor } from '@/lib/server/policy/types'
import { getChangelogSettings } from '@/lib/server/domains/settings/settings.changelog'

export async function isChangelogAudienceGranted(actor: Actor): Promise<boolean> {
  const { audience } = await getChangelogSettings()
  if (audience !== 'authenticated') return true
  if (isTeamActor(actor)) return true
  return actor.principalType === 'user'
}
