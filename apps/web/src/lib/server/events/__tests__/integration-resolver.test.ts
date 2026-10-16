import { describe, it, expect, vi } from 'vitest'
import { buildIntegrationTargets, type CachedMapping } from '../resolvers/integration.resolver'
function mapping(over: Partial<CachedMapping> = {}): CachedMapping {
  return {
    eventType: 'post.created',
    integrationType: 'slack',
    integrationId: 'integration-test',
    integrationConfig: {},
    actionConfig: { channelId: 'C1' },
    filters: null,
    ...over,
  }
}
describe('integration routing', () => {
  it('queues only the connection reference, never cached credentials or configuration', () => {
    const target = buildIntegrationTargets(
      [
        mapping({
          integrationConfig: {
            accessToken: 'old-secret',
            webhookSecret: 'secret',
            siteUrl: 'old-site',
          },
        }),
      ],
      'post.created',
      []
    )
    expect(target).toEqual([
      { type: 'slack', target: { channelId: 'C1' }, config: { integrationId: 'integration-test' } },
    ])
  })
  it('deduplicates the same destination without dropping another channel', () => {
    expect(
      buildIntegrationTargets(
        [mapping(), mapping(), mapping({ actionConfig: { channelId: 'C2' } })],
        'post.created',
        []
      )
    ).toHaveLength(2)
  })
  it('revalidates configured board filters', () => {
    const m = mapping({ filters: { boardIds: ['board_a'] } })
    expect(buildIntegrationTargets([m], 'post.created', ['board_b'])).toHaveLength(0)
    expect(buildIntegrationTargets([m], 'post.created', ['board_a'])).toHaveLength(1)
  })
  it('rejects targets without a destination or a connection identity', () => {
    expect(
      buildIntegrationTargets(
        [mapping({ actionConfig: {}, integrationConfig: {} })],
        'post.created',
        []
      )
    ).toHaveLength(0)
    expect(
      buildIntegrationTargets([mapping({ integrationId: '' })], 'post.created', [])
    ).toHaveLength(0)
  })
  it('ignores mappings for another event', () => {
    expect(
      buildIntegrationTargets([mapping({ eventType: 'comment.created' })], 'post.created', [])
    ).toHaveLength(0)
  })
  describe('ticket filters', () => {
    const repo = (filters: Record<string, unknown> | null) =>
      mapping({
        eventType: 'ticket.created',
        integrationType: 'github',
        actionConfig: { channelId: 'acme/api' },
        filters,
      })
    it('lets every ticket through a mapping without ticket filters', () => {
      expect(buildIntegrationTargets([repo(null)], 'ticket.created', [], {})).toHaveLength(1)
      expect(
        buildIntegrationTargets([repo(null)], 'ticket.created', [], {
          ticket: { teamId: null, ticketTypeId: null },
        })
      ).toHaveLength(1)
    })
    it('matches on the team and on the ticket type, each list on its own', () => {
      const byTeam = repo({ ticketTeamIds: ['team_a'] })
      const byType = repo({ ticketTypeIds: ['ticket_type_bug'] })
      const both = repo({ ticketTeamIds: ['team_a'], ticketTypeIds: ['ticket_type_bug'] })
      const ticket = (teamId: string | null, ticketTypeId: string | null) => ({
        ticket: { teamId, ticketTypeId },
      })
      expect(
        buildIntegrationTargets([byTeam], 'ticket.created', [], ticket('team_a', null))
      ).toHaveLength(1)
      expect(
        buildIntegrationTargets([byTeam], 'ticket.created', [], ticket('team_b', null))
      ).toHaveLength(0)
      expect(
        buildIntegrationTargets([byTeam], 'ticket.created', [], ticket(null, null))
      ).toHaveLength(0)
      expect(
        buildIntegrationTargets([byType], 'ticket.created', [], ticket(null, 'ticket_type_bug'))
      ).toHaveLength(1)
      expect(
        buildIntegrationTargets([byType], 'ticket.created', [], ticket('team_a', 'ticket_type_q'))
      ).toHaveLength(0)
      expect(
        buildIntegrationTargets([both], 'ticket.created', [], ticket('team_a', 'ticket_type_bug'))
      ).toHaveLength(1)
      expect(
        buildIntegrationTargets([both], 'ticket.created', [], ticket('team_a', 'ticket_type_q'))
      ).toHaveLength(0)
    })
    it('never matches a ticket-filtered mapping for an event without a ticket', () => {
      expect(
        buildIntegrationTargets([repo({ ticketTeamIds: ['team_a'] })], 'ticket.created', [], {})
      ).toHaveLength(0)
    })
  })

  describe('loop rule', () => {
    const own = mapping({ integrationPrincipalId: 'principal_github' })
    it("skips what the integration's own service principal did", () => {
      expect(
        buildIntegrationTargets([own], 'post.created', [], {
          actor: { type: 'service', id: 'principal_github' },
        })
      ).toHaveLength(0)
    })
    it('still sends what anyone else did, other service principals included', () => {
      for (const actor of [
        { type: 'user', id: 'principal_github' },
        { type: 'service', id: 'principal_other' },
        { type: 'service' },
      ])
        expect(buildIntegrationTargets([own], 'post.created', [], { actor })).toHaveLength(1)
    })
  })

  describe('resolve', () => {
    it('reads the team a ticket.assigned event moves to, and the type off its reference', async () => {
      const { integrationResolver } = await import('../resolvers/integration.resolver')
      const cache = await import('@/lib/server/cache')
      vi.spyOn(cache, 'cacheGet').mockResolvedValue([
        mapping({
          eventType: 'ticket.assigned',
          integrationType: 'github',
          actionConfig: { channelId: 'acme/api' },
          filters: { ticketTeamIds: ['team_new'], ticketTypeIds: ['ticket_type_bug'] },
          integrationPrincipalId: 'principal_github',
        }),
      ])
      const event = (actorType: string, actorId: string) =>
        ({
          type: 'ticket.assigned',
          entityType: 'ticket',
          entityId: 'ticket_1',
          actorType,
          actorId,
          payload: {
            ticket: { id: 'ticket_1', assignedTeamId: 'team_old', ticketTypeId: 'ticket_type_bug' },
            assignedTeamId: 'team_new',
            previousTeamId: 'team_old',
          },
        }) as never
      expect(await integrationResolver.resolve(event('user', 'principal_agent'))).toHaveLength(1)
      expect(await integrationResolver.resolve(event('service', 'principal_github'))).toHaveLength(
        0
      )
    })
  })
})
