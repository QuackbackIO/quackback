/**
 * One resolution reads the send guard's context once, however many candidate
 * addresses it tries. The context loads every verified domain from the
 * database, and resolution runs on every outbound email, so reading it per
 * candidate would turn one send into a query per address on a team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'

const contexts = vi.fn()

vi.mock('../outbound-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outbound-identity')>()
  return {
    ...actual,
    sendingIdentityContext: async () => {
      contexts()
      return {
        verifiedDomains: ['live.example'],
        platformFrom: 'Platform <noreply@platform.example>',
        inboundDomain: null,
        mailSlug: null,
        pooled: true,
      }
    },
  }
})

const rows = (addresses: string[]) => addresses.map((address, i) => ({ id: `ca_${i}`, address }))

vi.mock('../channel-account.service', () => ({
  defaultTeamId: async () => 'team_default' as TeamId,
  getChannelAccount: async () => null,
  listSendingAddresses: async (teamId: string) =>
    teamId === 'team_second'
      ? rows(['a@pending-one.example', 'b@pending-two.example', 'c@pending-three.example'])
      : rows(['d@pending-four.example', 'support@live.example']),
}))

const { resolveSender } = await import('../sender-resolver')

describe('resolveSender', () => {
  beforeEach(() => contexts.mockClear())

  it('reads the guard context once across every candidate it tries', async () => {
    const resolved = await resolveSender({ teamId: 'team_second' as TeamId })
    // Three refused rows on the assigned team, one refused and one permitted on
    // the default team: five candidates, one context.
    expect(resolved).toEqual({ from: 'support@live.example', source: 'default_team' })
    expect(contexts).toHaveBeenCalledTimes(1)
  })

  it('reads it once even when nothing is permitted', async () => {
    const resolved = await resolveSender({ teamId: 'team_second' as TeamId, module: 'changelog' })
    expect(resolved).toEqual({ from: 'support@live.example', source: 'default_team' })
    expect(contexts).toHaveBeenCalledTimes(1)
  })
})
