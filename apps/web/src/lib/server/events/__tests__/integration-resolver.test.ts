import { describe, it, expect } from 'vitest'
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
})
