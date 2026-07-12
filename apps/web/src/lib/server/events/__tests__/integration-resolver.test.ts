import { describe, it, expect } from 'vitest'
import { buildIntegrationTargets, type CachedMapping } from '../resolvers/integration.resolver'

/**
 * WO-8b — the integration resolver's pure target construction: event-type +
 * board filter, (integrationType, channelId) dedupe, and token decryption via an
 * injected decrypt. End-to-end parity vs getHookTargets lands in WO-15.
 */

const decrypt = (blob: string) => ({ accessToken: `token-for-${blob}` })

function mapping(over: Partial<CachedMapping>): CachedMapping {
  return {
    eventType: 'post.created',
    integrationType: 'slack',
    secrets: 'enc',
    integrationConfig: {},
    actionConfig: { channelId: 'C1' },
    filters: null,
    ...over,
  }
}

describe('buildIntegrationTargets (WO-8b)', () => {
  it('builds a target per mapping with decrypted token + rootUrl', () => {
    const targets = buildIntegrationTargets([mapping({})], 'post.created', [], 'https://p', decrypt)
    expect(targets).toEqual([
      {
        type: 'slack',
        target: { channelId: 'C1' },
        config: { accessToken: 'token-for-enc', rootUrl: 'https://p' },
      },
    ])
  })

  it('dedupes by (integrationType, channelId)', () => {
    const targets = buildIntegrationTargets(
      [mapping({}), mapping({})],
      'post.created',
      [],
      'https://p',
      decrypt
    )
    expect(targets).toHaveLength(1)
  })

  it('applies the board filter (skips a mapping whose boards do not overlap)', () => {
    const m = mapping({ filters: { boardIds: ['board_a'] } })
    expect(
      buildIntegrationTargets([m], 'post.created', ['board_b'], 'https://p', decrypt)
    ).toHaveLength(0)
    expect(
      buildIntegrationTargets([m], 'post.created', ['board_a'], 'https://p', decrypt)
    ).toHaveLength(1)
  })

  it('skips a mapping with no channel id and one whose secrets fail to decrypt', () => {
    const noChannel = mapping({ actionConfig: {}, integrationConfig: {} })
    expect(
      buildIntegrationTargets([noChannel], 'post.created', [], 'https://p', decrypt)
    ).toHaveLength(0)

    const boom = mapping({ channelIdShim: undefined } as never)
    const targets = buildIntegrationTargets([boom], 'post.created', [], 'https://p', () => {
      throw new Error('bad key')
    })
    expect(targets).toHaveLength(0)
  })

  it('ignores mappings for a different event type', () => {
    const other = mapping({ eventType: 'comment.created' })
    expect(buildIntegrationTargets([other], 'post.created', [], 'https://p', decrypt)).toHaveLength(
      0
    )
  })
})
