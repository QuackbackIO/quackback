/**
 * Widget viewer resolution: build a policy Actor from the widget's Bearer
 * session so widget reads can drive segment gates (help-center categories,
 * boards). Mirrors the inline pattern in routes/api/widget/search.ts.
 *
 * An unidentified caller (no/invalid Bearer) resolves to ANONYMOUS_ACTOR,
 * which fails closed: segment-gated content is invisible.
 */
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-viewer' })

export async function resolveWidgetViewer(): Promise<Actor> {
  try {
    const session = await getWidgetSession()
    if (!session) return ANONYMOUS_ACTOR
    const segmentIds = await segmentIdsForPrincipal(session.principal.id)
    return {
      principalId: session.principal.id,
      role: session.principal.role,
      // Widget principals are 'user' (identified) or 'anonymous' (visitor
      // tier); never collapse anonymous onto user — gates must stay closed.
      principalType: session.principal.type === 'user' ? 'user' : 'anonymous',
      segmentIds,
    }
  } catch (error) {
    // Fail CLOSED: an unresolvable viewer is anonymous and never sees
    // restricted content. Never fail the read itself over viewer resolution.
    log.warn({ err: error }, 'widget viewer resolution failed; treating as anonymous')
    return ANONYMOUS_ACTOR
  }
}
