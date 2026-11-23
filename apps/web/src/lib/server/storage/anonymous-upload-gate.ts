import type { PrincipalId } from '@quackback/ids'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { resolveTestFeedbackActor } from '@/lib/server/test-customer-feedback'

/**
 * Whether a person may upload media for posts and comments. Media goes into
 * what the workspace anonymous switch gates, so an anonymous session uploads
 * only while the switch is on, or when it is a teammate's test customer that
 * may still post (as `runCreatePublicPost` lets it).
 */
export async function mayUploadPostMedia(person: {
  id: PrincipalId
  type: string
}): Promise<boolean> {
  if (person.type !== 'anonymous') return true
  if ((await getPortalConfig()).features.allowAnonymous) return true
  const actor = await resolveTestFeedbackActor({
    principalId: person.id,
    role: 'user',
    principalType: 'anonymous',
    segmentIds: new Set(),
  })
  return actor.testFeedback?.canSubmit === true
}

export const ANONYMOUS_UPLOAD_REFUSED = { error: 'Anonymous interaction is not enabled' }
