/**
 * Remote status-push resolver (IF WO-15) — the OUTBOUND half of two-way status
 * sync. When a Quackback post/ticket status changes, this fans the change out
 * to every linked external item whose integration declares `remoteStatus.push`
 * and has mapped the new status under `pushStatusMappings`.
 *
 * LOOP-SAFETY: an inbound webhook applies its status change via the
 * integration's service principal, so the emitted status-changed event carries
 * `actorType='service'` + `actorId=<that integration's principalId>`. We never
 * push back to the integration that reported the change — only cross-integration
 * links and human-originated changes push. Suppression is keyed per link's
 * integration, so a Linear-reported change still syncs out to a linked GitHub
 * issue.
 */
import {
  db,
  integrations,
  postExternalLinks,
  ticketExternalLinks,
  posts,
  tickets,
  eq,
  and,
} from '@/lib/server/db'
import { getIntegration } from '@/lib/server/integrations'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

/** One active external link enriched with its integration's push context. */
export interface PushLinkRow {
  linkId: string
  externalId: string
  integrationId: string | null
  integrationType: string
  /** The integration's service-principal id — the loop-safety key. */
  integrationPrincipalId: string | null
  /** `pushStatusMappings` (posts) / `ticketPushStatusMappings` (tickets): Quackback statusId → remote status. */
  pushStatusMappings: Record<string, string> | undefined
}

/**
 * Pure target construction (unit-testable). For each active link, emit a
 * `remote_status_push` target unless: the link has no integration, the provider
 * has no push capability, the change came FROM that integration (loop-safety),
 * or the new status isn't mapped for pushing.
 */
export function buildRemoteStatusPushTargets(params: {
  links: PushLinkRow[]
  statusId: string
  actorType: string
  actorId: string | undefined
  entityType: string
  hasPushCapability: (integrationType: string) => boolean
}): HookTarget[] {
  const { links, statusId, actorType, actorId, entityType, hasPushCapability } = params
  const targets: HookTarget[] = []
  for (const link of links) {
    if (!link.integrationId) continue
    if (!hasPushCapability(link.integrationType)) continue
    // Never re-push to the integration that reported this very change.
    if (actorType === 'service' && actorId && link.integrationPrincipalId === actorId) continue
    const remoteStatus = link.pushStatusMappings?.[statusId]
    if (!remoteStatus) continue
    targets.push({
      type: 'remote_status_push',
      target: { integrationType: link.integrationType, externalId: link.externalId, entityType },
      config: { integrationId: link.integrationId, remoteStatus },
      // Idempotent per (link, status) so a redelivered event doesn't double-push.
      deliveryKey: `push:${link.linkId}:${statusId}`,
    })
  }
  return targets
}

async function resolvePostLinks(
  postId: string
): Promise<{ statusId: string | null; links: PushLinkRow[] }> {
  const [post] = await db
    .select({ statusId: posts.statusId })
    .from(posts)
    .where(eq(posts.id, postId as never))
    .limit(1)
  if (!post?.statusId) return { statusId: null, links: [] }

  const rows = await db
    .select({
      linkId: postExternalLinks.id,
      externalId: postExternalLinks.externalId,
      integrationId: postExternalLinks.integrationId,
      integrationType: postExternalLinks.integrationType,
      integrationPrincipalId: integrations.principalId,
      config: integrations.config,
    })
    .from(postExternalLinks)
    .leftJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
    .where(
      and(eq(postExternalLinks.postId, postId as never), eq(postExternalLinks.status, 'active'))
    )

  const links = rows.map((r) => ({
    linkId: r.linkId,
    externalId: r.externalId,
    integrationId: r.integrationId,
    integrationType: r.integrationType,
    integrationPrincipalId: r.integrationPrincipalId ?? null,
    pushStatusMappings: (r.config as Record<string, unknown> | null)?.pushStatusMappings as
      | Record<string, string>
      | undefined,
  }))
  return { statusId: post.statusId, links }
}

async function resolveTicketLinks(
  ticketId: string
): Promise<{ statusId: string | null; links: PushLinkRow[] }> {
  const [ticket] = await db
    .select({ statusId: tickets.statusId })
    .from(tickets)
    .where(eq(tickets.id, ticketId as never))
    .limit(1)
  if (!ticket?.statusId) return { statusId: null, links: [] }

  const rows = await db
    .select({
      linkId: ticketExternalLinks.id,
      externalId: ticketExternalLinks.externalId,
      integrationId: ticketExternalLinks.integrationId,
      integrationType: ticketExternalLinks.integrationType,
      integrationPrincipalId: integrations.principalId,
      config: integrations.config,
    })
    .from(ticketExternalLinks)
    .leftJoin(integrations, eq(ticketExternalLinks.integrationId, integrations.id))
    .where(
      and(
        eq(ticketExternalLinks.ticketId, ticketId as never),
        eq(ticketExternalLinks.status, 'active')
      )
    )

  const links = rows.map((r) => ({
    linkId: r.linkId,
    externalId: r.externalId,
    integrationId: r.integrationId,
    integrationType: r.integrationType,
    integrationPrincipalId: r.integrationPrincipalId ?? null,
    pushStatusMappings: (r.config as Record<string, unknown> | null)?.ticketPushStatusMappings as
      | Record<string, string>
      | undefined,
  }))
  return { statusId: ticket.statusId, links }
}

export const remoteStatusPushResolver: SinkResolver = {
  sink: 'remote_status_push',
  interestedIn(type: string): boolean {
    return type === 'post.status_changed' || type === 'ticket.status_changed'
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    const isPost = event.type === 'post.status_changed'
    const { statusId, links } = isPost
      ? await resolvePostLinks(event.entityId)
      : await resolveTicketLinks(event.entityId)
    if (!statusId || links.length === 0) return []

    return buildRemoteStatusPushTargets({
      links,
      statusId,
      actorType: event.actorType,
      actorId: event.actorId,
      entityType: isPost ? 'post' : 'ticket',
      hasPushCapability: (type) => typeof getIntegration(type)?.remoteStatus?.push === 'function',
    })
  },
}
