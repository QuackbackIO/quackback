/**
 * The pure half of sending-domain provisioning: what a domain owner is asked to
 * publish, which domains may never be claimed, and when both authorities agree
 * a domain is verified.
 */
import { describe, it, expect } from 'vitest'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import {
  MAIL_FROM_LABEL,
  OWNERSHIP_RECORD_HOST,
  OWNERSHIP_VALUE_PREFIX,
  SendingDomainRefusedError,
  domainsOverlap,
  mailFromDomainFor,
  mintOwnershipToken,
  normalizeSendingDomain,
  ownershipRecordsOf,
  sendingDomainDnsRecords,
  sendingDomainStatusFrom,
} from '../sending-identity'

const REGION = 'eu-west-2'

const identity = (over: Partial<SesDomainIdentity> = {}): SesDomainIdentity => ({
  domain: 'tenant-a.example',
  dkimTokens: ['aaa', 'bbb', 'ccc'],
  signingHostedZone: null,
  dkimStatus: 'SUCCESS',
  verifiedForSending: true,
  mailFrom: { domain: 'bounce.tenant-a.example', status: 'SUCCESS' },
  ...over,
})

describe('the records a domain owner has to publish', () => {
  it('carries the ownership token, three DKIM CNAMEs, and the MAIL FROM pair', () => {
    const records = sendingDomainDnsRecords({
      domain: 'tenant-a.example',
      region: REGION,
      ownershipToken: 'tok',
      identity: identity(),
    })

    expect(records.filter((r) => r.purpose === 'ownership')).toEqual([
      {
        type: 'TXT',
        host: OWNERSHIP_RECORD_HOST,
        value: `${OWNERSHIP_VALUE_PREFIX}tok`,
        purpose: 'ownership',
      },
    ])
    expect(records.filter((r) => r.purpose === 'dkim')).toEqual([
      {
        type: 'CNAME',
        host: 'aaa._domainkey',
        value: `aaa.dkim.${REGION}.amazonses.com`,
        purpose: 'dkim',
      },
      {
        type: 'CNAME',
        host: 'bbb._domainkey',
        value: `bbb.dkim.${REGION}.amazonses.com`,
        purpose: 'dkim',
      },
      {
        type: 'CNAME',
        host: 'ccc._domainkey',
        value: `ccc.dkim.${REGION}.amazonses.com`,
        purpose: 'dkim',
      },
    ])
    expect(records.filter((r) => r.purpose === 'mail-from')).toEqual([
      {
        type: 'MX',
        host: MAIL_FROM_LABEL,
        value: `feedback-smtp.${REGION}.amazonses.com`,
        priority: 10,
        purpose: 'mail-from',
      },
      {
        type: 'TXT',
        host: MAIL_FROM_LABEL,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'mail-from',
      },
    ])
  })

  it('points the DKIM CNAMEs at the zone the provider named, when it names one', () => {
    // Newer regions publish keys somewhere other than the historical
    // dkim.<region> zone, and a CNAME at the wrong zone never resolves.
    const records = sendingDomainDnsRecords({
      domain: 'tenant-a.example',
      region: REGION,
      ownershipToken: 'tok',
      identity: identity({ dkimTokens: ['aaa'], signingHostedZone: 'dkim.elsewhere.example' }),
    })
    expect(records.find((r) => r.purpose === 'dkim')?.value).toBe('aaa.dkim.elsewhere.example')
  })

  it('still names the ownership and MAIL FROM records before any DKIM token exists', () => {
    // A freshly created identity has no tokens for a moment. The row is written
    // with what exists and the poll fills the rest in.
    const records = sendingDomainDnsRecords({
      domain: 'tenant-a.example',
      region: REGION,
      ownershipToken: 'tok',
      identity: identity({ dkimTokens: [] }),
    })
    expect(records.filter((r) => r.purpose === 'dkim')).toEqual([])
    expect(records).toHaveLength(3)
  })

  it('mints a token per row, so no two rows can be proved by one record', () => {
    expect(mintOwnershipToken()).not.toBe(mintOwnershipToken())
    expect(mintOwnershipToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('finds the ownership record back out of a stored set', () => {
    const records = sendingDomainDnsRecords({
      domain: 'tenant-a.example',
      region: REGION,
      ownershipToken: 'tok',
      identity: identity(),
    })
    expect(ownershipRecordsOf(records)).toHaveLength(1)
    expect(ownershipRecordsOf([])).toEqual([])
  })

  it('discards a stored ownership record that carries no token', () => {
    // The token is read back by removing the prefix, so a value without it
    // yields a slice of somebody else's string: a token nobody was issued, that
    // the owner cannot publish, and that would keep the row pending forever
    // while looking checked. Treated as absent, so a real one is re-issued.
    expect(
      ownershipRecordsOf([
        { type: 'TXT', host: '_quackback', value: 'v=spf1 -all', purpose: 'ownership' },
      ])
    ).toEqual([])
    // And the record's TYPE is checked too, not only its purpose.
    expect(
      ownershipRecordsOf([
        {
          type: 'CNAME',
          host: '_quackback',
          value: `${OWNERSHIP_VALUE_PREFIX}tok`,
          purpose: 'ownership',
        },
      ])
    ).toEqual([])
  })

  it('puts the MAIL FROM on a subdomain that receives no mail', () => {
    expect(mailFromDomainFor('tenant-a.example')).toBe('bounce.tenant-a.example')
  })
})

describe('domains that may never be claimed', () => {
  const env = {
    EMAIL_FROM: 'Quackback <notifications@mail.platform.test>',
    EMAIL_INBOUND_DOMAIN: 'inbound.platform.test',
  }

  it('normalises what a person actually types', () => {
    expect(normalizeSendingDomain('  HTTPS://Tenant-A.Example/mail  ', {})).toBe('tenant-a.example')
    expect(normalizeSendingDomain('tenant-a.example.', {})).toBe('tenant-a.example')
  })

  it('stores an internationalised domain in the form everything else speaks', () => {
    // DNS resolves A-labels, the provider registers an identity under one, and
    // the send-time guard compares against one. A row stored in unicode would
    // never match the address it was added for, and the failure is silent: the
    // reply goes out from the platform sender instead.
    expect(normalizeSendingDomain('MÜNCHEN.Example', {})).toBe('xn--mnchen-3ya.example')
    expect(normalizeSendingDomain('xn--mnchen-3ya.example', {})).toBe('xn--mnchen-3ya.example')
  })

  it('refuses a platform domain written in the other spelling', () => {
    // Both sides are normalised, so the refusal cannot be walked past by typing
    // the same domain a different way.
    const idnEnv = { EMAIL_INBOUND_DOMAIN: 'xn--mnchen-3ya.example' }
    expect(() => normalizeSendingDomain('münchen.example', idnEnv)).toThrow(
      SendingDomainRefusedError
    )
  })

  it('refuses an address, and anything that is not a domain', () => {
    expect(() => normalizeSendingDomain('support@tenant-a.example', {})).toThrow(
      SendingDomainRefusedError
    )
    expect(() => normalizeSendingDomain('localhost', {})).toThrow(SendingDomainRefusedError)
    expect(() => normalizeSendingDomain('-bad-.example', {})).toThrow(SendingDomainRefusedError)
  })

  it('refuses the platform’s own mail domains, above and below', () => {
    // A verified identity covers its subdomains, so claiming a PARENT of a
    // platform domain is the worse of the two and has to be refused as well.
    expect(() => normalizeSendingDomain('mail.platform.test', env)).toThrow(
      SendingDomainRefusedError
    )
    expect(() => normalizeSendingDomain('sub.mail.platform.test', env)).toThrow(
      SendingDomainRefusedError
    )
    expect(() => normalizeSendingDomain('platform.test', env)).toThrow(SendingDomainRefusedError)
    expect(() => normalizeSendingDomain('inbound.platform.test', env)).toThrow(
      SendingDomainRefusedError
    )
    // A domain that merely ends in the same letters is not one of ours.
    expect(normalizeSendingDomain('notplatform.test', env)).toBe('notplatform.test')
  })

  it('refuses a domain the platform still receives on after retiring it from minting', () => {
    // The accept-set only grows, and this refusal grows with it. A domain no
    // longer minted on is still one the platform's own mail arrives at, so a
    // workspace that could claim it would be verifying a zone that already
    // carries every reply address minted before the change.
    const afterTheChange = { ...env, EMAIL_INBOUND_EXTRA_DOMAINS: 'mail.oldbrand.test' }

    expect(() => normalizeSendingDomain('mail.oldbrand.test', afterTheChange)).toThrow(
      SendingDomainRefusedError
    )
    // Below it, for the same reason the minting domain is refused downward.
    expect(() => normalizeSendingDomain('sub.mail.oldbrand.test', afterTheChange)).toThrow(
      SendingDomainRefusedError
    )
    // AND THE ZONE ABOVE IT, which is what an entry really costs and who pays.
    // A customer who owns `oldbrand.test` can never verify it while the platform
    // lists a subdomain of it, the list only grows in practice, and the refusal
    // does not explain itself to them. Pinned rather than left implicit: the
    // both-direction rule is what stops a verified parent from carrying sending
    // rights over the subdomain our own reply addresses live on, so the cost is
    // accepted — but it is a cost, and it is why the extras may only ever name a
    // zone this platform operates.
    expect(() => normalizeSendingDomain('oldbrand.test', afterTheChange)).toThrow(
      SendingDomainRefusedError
    )
    // Without the extras all three are domains like any other, which is what
    // makes the refusals above the accept-set answering rather than something
    // else.
    expect(normalizeSendingDomain('mail.oldbrand.test', env)).toBe('mail.oldbrand.test')
    expect(normalizeSendingDomain('oldbrand.test', env)).toBe('oldbrand.test')
  })

  it('domainsOverlap answers both directions and nothing else', () => {
    expect(domainsOverlap('a.example', 'a.example')).toBe(true)
    expect(domainsOverlap('x.a.example', 'a.example')).toBe(true)
    expect(domainsOverlap('a.example', 'x.a.example')).toBe(true)
    expect(domainsOverlap('xa.example', 'a.example')).toBe(false)
  })
})

describe('when a domain counts as verified', () => {
  it('needs the provider AND this workspace’s own proof of ownership', () => {
    // The provider reports a domain verified to every workspace on the shared
    // account, including one that has proved nothing. Its answer alone must
    // never verify a row.
    expect(sendingDomainStatusFrom({ identity: identity(), ownershipProven: false })).toBe(
      'pending'
    )
    expect(sendingDomainStatusFrom({ identity: identity(), ownershipProven: true })).toBe(
      'verified'
    )
  })

  it('needs the custom MAIL FROM, not just DKIM', () => {
    // Without it there is no aligned SPF and DMARC rests on DKIM alone, which is
    // exactly the arrangement that fails once a message is forwarded.
    expect(
      sendingDomainStatusFrom({
        identity: identity({ mailFrom: { domain: 'bounce.tenant-a.example', status: 'PENDING' } }),
        ownershipProven: true,
      })
    ).toBe('pending')
    expect(
      sendingDomainStatusFrom({ identity: identity({ mailFrom: null }), ownershipProven: true })
    ).toBe('pending')
  })

  it('stays pending while the provider is still looking, and fails when it gives up', () => {
    expect(
      sendingDomainStatusFrom({
        identity: identity({ dkimStatus: 'PENDING' }),
        ownershipProven: true,
      })
    ).toBe('pending')
    expect(
      sendingDomainStatusFrom({
        identity: identity({ dkimStatus: 'TEMPORARY_FAILURE' }),
        ownershipProven: true,
      })
    ).toBe('pending')
    expect(
      sendingDomainStatusFrom({
        identity: identity({ dkimStatus: 'FAILED' }),
        ownershipProven: true,
      })
    ).toBe('failed')
  })

  it('stays pending when the provider has never heard of the identity', () => {
    expect(sendingDomainStatusFrom({ identity: null, ownershipProven: true })).toBe('pending')
  })

  it('is not fooled by an identity the provider will not actually sign for', () => {
    expect(
      sendingDomainStatusFrom({
        identity: identity({ verifiedForSending: false }),
        ownershipProven: true,
      })
    ).toBe('pending')
  })
})
