/**
 * Route a ticket's status, priority, assignee and title changes to the issues
 * it is linked to, for providers that keep the guarded write contract
 * (`issues.writeContract: 'guarded'`). One target per active link; queueing
 * (`queueIssueUpdateSync`) decides whether that link's destination updates
 * its issues automatically, and the worker asks again before writing.
 *
 * LOOP-SAFETY: a change the integration's own service principal made came
 * from that platform, so it is never sent back to it; and nothing applied by
 * integration sync (`context.source: 'integration-sync'`, any provider's
 * inbound status) is pushed on to an issue, so one platform's change is
 * never mirrored onto another's.
 */
import { db, integrations, ticketExternalLinks, eq, and } from '@/lib/server/db'
import { getIntegration } from '@/lib/server/integrations'
import {
  ISSUE_UPDATE_EVENTS,
  ISSUE_UPDATE_HOOK,
  issueUpdateKind,
  updatesIssuesGuarded,
} from '@/lib/server/integrations/sync/issue-updates'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

/** One active link of the ticket, with its integration's loop-safety key. */
export interface IssueUpdateLinkRow {
  linkId: string
  integrationId: string | null
  integrationType: string
  integrationPrincipalId: string | null
}

/** Pure target construction (unit-testable). */
export function buildIssueUpdateTargets(params: {
  links: IssueUpdateLinkRow[]
  actorType: string
  actorId: string | undefined
  source: string | undefined
  updatesIssues: (integrationType: string) => boolean
}): HookTarget[] {
  if (params.source === 'integration-sync') return []
  const targets: HookTarget[] = []
  for (const link of params.links) {
    if (!link.integrationId || !params.updatesIssues(link.integrationType)) continue
    if (
      params.actorType === 'service' &&
      params.actorId &&
      link.integrationPrincipalId === params.actorId
    )
      continue
    targets.push({
      type: ISSUE_UPDATE_HOOK,
      target: { linkId: link.linkId },
      config: { integrationId: link.integrationId },
      deliveryKey: `issue-update:${link.linkId}`,
    })
  }
  return targets
}

export const issueUpdateResolver: SinkResolver = {
  sink: ISSUE_UPDATE_HOOK,
  interestedIn(type: string): boolean {
    return ISSUE_UPDATE_EVENTS.includes(type)
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    if (event.entityType !== 'ticket') return []
    if (!issueUpdateKind({ type: event.type, data: event.payload })) return []
    const links = await db
      .select({
        linkId: ticketExternalLinks.id,
        integrationId: ticketExternalLinks.integrationId,
        integrationType: ticketExternalLinks.integrationType,
        integrationPrincipalId: integrations.principalId,
      })
      .from(ticketExternalLinks)
      .innerJoin(integrations, eq(ticketExternalLinks.integrationId, integrations.id))
      .where(
        and(
          eq(ticketExternalLinks.ticketId, event.entityId as never),
          eq(ticketExternalLinks.status, 'active'),
          eq(integrations.status, 'active')
        )
      )
    if (links.length === 0) return []
    return buildIssueUpdateTargets({
      links,
      actorType: event.actorType,
      actorId: event.actorId,
      source: event.context?.source,
      updatesIssues: (type) => updatesIssuesGuarded(getIntegration(type)),
    })
  },
}
