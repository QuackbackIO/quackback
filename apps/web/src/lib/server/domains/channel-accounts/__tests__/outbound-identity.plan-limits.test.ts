/**
 * A sending domain the plan holds back (past its cap, after the grace) sends
 * from the default sender instead, and that fallback never fails a send.
 *
 * The plan limits answer is a stand-in returning the domain ids that keep
 * sending, as the real `activeSendingDomainIds` does; the real answer is
 * proved against a database in plan-limits.team.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  verified: [] as { id: string; domain: string }[],
  active: null as null | string[] | Error,
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const chain = { from: () => chain, where: async () => hoisted.verified }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain },
  }
})
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  activeSendingDomainIds: async () => {
    if (hoisted.active instanceof Error) throw hoisted.active
    return hoisted.active
  },
}))

import {
  assertSendingIdentityPermitted,
  isSendingIdentityPermitted,
  permittedSendingIdentity,
  sendingIdentityContext,
  type SendingIdentityContext,
} from '../outbound-identity'

const ctx = (over: Partial<SendingIdentityContext>): SendingIdentityContext => ({
  verifiedDomains: ['acme.example', 'news.example'],
  platformFrom: 'Platform <noreply@platform.example>',
  inboundDomain: null,
  mailSlug: null,
  pooled: false,
  ...over,
})

const SINGLE = { EMAIL_FROM: 'noreply@platform.example' }

beforeEach(() => {
  hoisted.verified = [
    { id: 'dom_acme', domain: 'acme.example' },
    { id: 'dom_news', domain: 'news.example' },
  ]
  hoisted.active = null
})

describe('isSendingIdentityPermitted with held domains', () => {
  it('refuses a held domain and its subdomains, even on a single-workspace install', () => {
    const held = ctx({ pausedDomains: ['news.example'] })
    expect(isSendingIdentityPermitted('updates@news.example', held)).toBe(false)
    expect(isSendingIdentityPermitted('updates@mail.news.example', held)).toBe(false)
    expect(isSendingIdentityPermitted('hello@acme.example', held)).toBe(true)
  })

  it('still sends as the platform default and as a domain another kept domain covers', () => {
    expect(
      isSendingIdentityPermitted(
        'noreply@platform.example',
        ctx({ pausedDomains: ['platform.example'] })
      )
    ).toBe(true)
    expect(
      isSendingIdentityPermitted(
        'help@mail.acme.example',
        ctx({
          verifiedDomains: ['acme.example', 'mail.acme.example'],
          pausedDomains: ['mail.acme.example'],
        })
      )
    ).toBe(true)
  })
})

describe('the send path', () => {
  it('falls back once a domain is held, and not before', async () => {
    expect(
      await permittedSendingIdentity('updates@news.example', await sendingIdentityContext(SINGLE))
    ).toBe('updates@news.example')
    hoisted.active = ['dom_acme']
    const context = await sendingIdentityContext(SINGLE)
    expect([...(context.pausedDomains ?? [])]).toEqual(['news.example'])
    expect(await permittedSendingIdentity('updates@news.example', context)).toBeNull()
    expect(await permittedSendingIdentity('hello@acme.example', context)).toBe('hello@acme.example')
  })

  it('never throws when the plan limits read fails, and holds nothing back', async () => {
    hoisted.active = new Error('plan limits unavailable')
    const context = await sendingIdentityContext(SINGLE)
    expect([...(context.pausedDomains ?? [])]).toEqual([])
    expect(await permittedSendingIdentity('updates@news.example', context)).toBe(
      'updates@news.example'
    )
  })

  it('still lets an address on a held domain be chosen in settings', async () => {
    hoisted.active = ['dom_acme']
    await expect(assertSendingIdentityPermitted('updates@news.example')).resolves.toBe(
      'updates@news.example'
    )
  })
})
