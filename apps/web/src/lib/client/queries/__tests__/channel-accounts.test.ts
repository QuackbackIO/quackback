/**
 * The email settings card keeps itself current while a domain is being
 * checked automatically, and goes quiet once nothing is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  EmailChannelConfigDTO,
  SendingDomainDTO,
} from '@/lib/server/functions/channel-accounts'
import { emailChannelConfigQuery } from '../channel-accounts'

const NOW = new Date('2026-11-04T12:00:00Z')
const hour = 3600_000

const domain = (over: Partial<SendingDomainDTO>): SendingDomainDTO => ({
  id: 'd1',
  domain: 'acme.com',
  status: 'pending',
  dnsRecords: [],
  verifiedAt: null,
  mailFromLabel: 'qb-bounce',
  dkimMode: 'byo',
  autoCheckUntil: new Date(NOW.getTime() + hour).toISOString(),
  lastCheckedAt: null,
  preflight: {},
  ...over,
})

const config = (domains: SendingDomainDTO[]): EmailChannelConfigDTO => ({
  inboundRoute: null,
  sendingAddresses: [],
  domains,
  platformAddress: null,
  addressMode: 'verified-domains',
  defaultFrom: null,
  sendingPaused: null,
})

/** The interval the query asks for with this config cached. */
function intervalWith(data: EmailChannelConfigDTO | undefined) {
  const interval = emailChannelConfigQuery().refetchInterval
  if (typeof interval !== 'function') return interval
  // The callback reads only the cached data off the query it is handed.
  return interval({ state: { data } } as unknown as Parameters<typeof interval>[0])
}

describe('emailChannelConfigQuery polling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls while a pending domain is inside its automatic check window', () => {
    vi.useFakeTimers({ now: NOW })
    expect(intervalWith(config([domain({})]))).toBe(60_000)
  })

  it('stops once no domain is being checked automatically', () => {
    vi.useFakeTimers({ now: NOW })
    expect(intervalWith(config([domain({ status: 'verified' })]))).toBe(false)
    expect(
      intervalWith(
        config([domain({ autoCheckUntil: new Date(NOW.getTime() - hour).toISOString() })])
      )
    ).toBe(false)
    expect(intervalWith(config([domain({ autoCheckUntil: null })]))).toBe(false)
    expect(intervalWith(config([]))).toBe(false)
    expect(intervalWith(undefined)).toBe(false)
  })
})
