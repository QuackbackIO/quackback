import { describe, expect, it } from 'vitest'
import { syncHistoryAvailable } from '../availability'

const base = {
  provider: 'linear',
  status: 'active' as string | null,
  config: { channelId: 'team_1' },
  notificationChannels: [] as { channelId: string }[],
  writesLedger: true,
  connectionIsDestination: false,
  slackAssistantEnabled: false,
}

describe('syncHistoryAvailable', () => {
  it('hides history until a destination is selected', () => {
    expect(syncHistoryAvailable({ ...base, config: {} }).reason).toBe('no_destination')
    expect(syncHistoryAvailable({ ...base, status: 'paused' }).reason).toBe('not_active')
    expect(syncHistoryAvailable({ ...base, status: null }).reason).toBe('no_installation')
    expect(syncHistoryAvailable({ ...base, writesLedger: false }).reason).toBe('no_ledger')
    expect(syncHistoryAvailable(base).available).toBe(true)
  })

  it('accepts a bare Jira project id and rejects an empty colon side', () => {
    expect(
      syncHistoryAvailable({ ...base, provider: 'jira', config: { channelId: '10000' } }).available
    ).toBe(true)
    expect(
      syncHistoryAvailable({ ...base, provider: 'jira', config: { channelId: '10000:' } }).available
    ).toBe(false)
    expect(
      syncHistoryAvailable({ ...base, provider: 'jira', config: { channelId: ':10001' } }).available
    ).toBe(false)
    expect(
      syncHistoryAvailable({ ...base, provider: 'jira', config: { channelId: '10000:10001' } })
        .available
    ).toBe(true)
  })

  it('requires both sides of an Azure destination', () => {
    expect(
      syncHistoryAvailable({ ...base, provider: 'azure_devops', config: { channelId: 'Proj' } })
        .available
    ).toBe(false)
    expect(
      syncHistoryAvailable({
        ...base,
        provider: 'azure_devops',
        config: { channelId: 'Proj:Task' },
      }).available
    ).toBe(true)
  })

  it('treats a Slack or Discord routed channel, or the Slack assistant, as a destination', () => {
    expect(
      syncHistoryAvailable({
        ...base,
        provider: 'slack',
        config: {},
        notificationChannels: [{ channelId: 'C1' }],
      }).available
    ).toBe(true)
    expect(
      syncHistoryAvailable({ ...base, provider: 'discord', config: { channelId: '' } }).available
    ).toBe(false)
    expect(
      syncHistoryAvailable({ ...base, provider: 'slack', config: {}, slackAssistantEnabled: true })
        .available
    ).toBe(true)
  })

  it('treats an active Segment connection as the destination', () => {
    expect(
      syncHistoryAvailable({
        ...base,
        provider: 'segment',
        config: {},
        connectionIsDestination: true,
      }).available
    ).toBe(true)
  })
})
