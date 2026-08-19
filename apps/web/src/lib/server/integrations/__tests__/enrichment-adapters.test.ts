/**
 * Customer-context adapters (IF WO-9): each provider maps its native contact
 * shape onto the normalized EnrichmentCard the generic panel renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => vi.clearAllMocks())

vi.mock('@/integrations/zendesk/server/context', () => ({ searchZendeskUser: vi.fn() }))
vi.mock('@/integrations/hubspot/server/context', () => ({ searchHubSpotContact: vi.fn() }))
vi.mock('@/integrations/intercom/server/context', () => ({ searchContact: vi.fn() }))

import { zendeskContext } from '@/integrations/zendesk/server/enrichment'
import { hubspotContext } from '@/integrations/hubspot/server/enrichment'
import { intercomContext } from '@/integrations/intercom/server/enrichment'
import { searchZendeskUser } from '@/integrations/zendesk/server/context'
import { searchHubSpotContact } from '@/integrations/hubspot/server/context'
import { searchContact } from '@/integrations/intercom/server/context'

describe('zendeskContext', () => {
  it('maps a user + org + tags to a card with a deep link', async () => {
    vi.mocked(searchZendeskUser).mockResolvedValue({
      id: 5,
      name: 'Ada',
      email: 'ada@acme.co',
      role: 'end-user',
      organization: { id: 1, name: 'Acme' },
      tags: ['vip', 'beta'],
    })
    const card = await zendeskContext({
      accessToken: 't',
      config: { subdomain: 'acme' },
      email: 'ada@acme.co',
    })
    expect(card).toMatchObject({
      provider: 'zendesk',
      name: 'Ada',
      company: 'Acme',
      url: 'https://acme.zendesk.com/agent/users/5',
    })
    expect(card!.fields).toEqual([
      { label: 'Role', value: 'end-user' },
      { label: 'Tags', value: 'vip, beta' },
    ])
  })

  it('returns null without a subdomain in config', async () => {
    expect(await zendeskContext({ accessToken: 't', config: {}, email: 'x@y.z' })).toBeNull()
    expect(searchZendeskUser).not.toHaveBeenCalled()
  })

  it('returns null on no match', async () => {
    vi.mocked(searchZendeskUser).mockResolvedValue(null)
    expect(
      await zendeskContext({ accessToken: 't', config: { subdomain: 'acme' }, email: 'x@y.z' })
    ).toBeNull()
  })
})

describe('hubspotContext', () => {
  it('maps name/company/deal value onto the card', async () => {
    vi.mocked(searchHubSpotContact).mockResolvedValue({
      id: '99',
      email: 'ada@acme.co',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Acme',
      lifecycleStage: 'customer',
      totalDealValue: 12000,
      deals: [{ id: 'd1', name: 'Enterprise', stage: 'won', amount: 12000 }],
    })
    const card = await hubspotContext({ accessToken: 't', config: {}, email: 'ada@acme.co' })
    expect(card).toMatchObject({ provider: 'hubspot', name: 'Ada Lovelace', company: 'Acme' })
    expect(card!.url).toBe('https://app.hubspot.com/contacts/contact/99')
    expect(card!.fields).toEqual([
      { label: 'Lifecycle', value: 'customer' },
      { label: 'Deal value', value: '$12,000' },
      { label: 'Open deals', value: '1' },
    ])
  })
})

describe('intercomContext', () => {
  it('maps name/company/plan onto the card', async () => {
    vi.mocked(searchContact).mockResolvedValue({
      id: 'c1',
      name: 'Ada',
      email: 'ada@acme.co',
      company: { id: 'o1', name: 'Acme' },
      customAttributes: { plan: 'Pro' },
      tags: ['trial'],
    })
    const card = await intercomContext({ accessToken: 't', config: {}, email: 'ada@acme.co' })
    expect(card).toMatchObject({ provider: 'intercom', name: 'Ada', company: 'Acme' })
    expect(card!.fields).toEqual([
      { label: 'Plan', value: 'Pro' },
      { label: 'Tags', value: 'trial' },
    ])
  })
})
