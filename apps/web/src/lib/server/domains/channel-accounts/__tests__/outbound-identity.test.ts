/**
 * The isolation property, stated directly.
 *
 * Every workspace on a fleet sends through one mail provider account. The
 * provider signs for any identity verified on that account and cannot tell which
 * workspace an identity belongs to, so it will sign a message from workspace B
 * claiming to be `support@tenant-a.example` the moment workspace A verifies that
 * domain. Nothing on the provider's side prevents that. This guard is the only
 * thing that does, which is why it is tested as a rule rather than inferred from
 * a query being scoped.
 */
import { describe, it, expect, vi } from 'vitest'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'

// The one query the context gathers is this workspace's verified domains. It is
// empty here on purpose: what these cases are about is what the PLATFORM's
// configuration grants, which is the half a verified-domain row would mask.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const chain = { from: () => chain, where: async () => [] }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain },
  }
})

import {
  isSendingIdentityPermitted,
  permittedSendingIdentity,
  platformSendingDomains,
  toAsciiDomain,
  withSendingDisplayName,
  type SendingIdentityContext,
} from '../outbound-identity'
import type { SendingIdentity } from '@quackback/email/sender'

/** Workspace B: on the fleet, with its own slug, owning nothing of its own. */
const workspaceB: SendingIdentityContext = {
  verifiedDomains: [],
  platformFrom: 'Quackback <notifications@mail.platform.test>',
  inboundDomain: 'mail.platform.test',
  mailSlug: 'beta',
  pooled: true,
}

describe('a workspace cannot send from another workspace’s verified domain', () => {
  it('refuses a domain this workspace has not verified, however verified it is elsewhere', () => {
    // tenant-a.example is fully verified on the shared provider account by
    // workspace A. Workspace B's own record of verified domains is empty, and
    // that is the whole of the evidence this guard will accept.
    expect(isSendingIdentityPermitted('support@tenant-a.example', workspaceB)).toBe(false)
    expect(isSendingIdentityPermitted('Support <support@tenant-a.example>', workspaceB)).toBe(false)
    // Nor a subdomain of it, which the provider would also sign for.
    expect(isSendingIdentityPermitted('support@mail.tenant-a.example', workspaceB)).toBe(false)
  })

  it('permits the same address once THIS workspace has verified the domain', () => {
    const owner = { ...workspaceB, verifiedDomains: ['tenant-a.example'] }
    expect(isSendingIdentityPermitted('support@tenant-a.example', owner)).toBe(true)
    // A verified parent covers its subdomains, matching what the provider does.
    expect(isSendingIdentityPermitted('billing@mail.tenant-a.example', owner)).toBe(true)
    // ...and covers nothing outside it.
    expect(isSendingIdentityPermitted('support@tenant-a.example.evil.test', owner)).toBe(false)
    expect(isSendingIdentityPermitted('support@nottenant-a.example', owner)).toBe(false)
  })

  it('refuses another workspace’s slug on the shared inbound domain', () => {
    // The one domain every workspace legitimately has an address on. The label
    // is the only thing separating them, so it is the only thing that may be
    // matched on.
    expect(isSendingIdentityPermitted('beta@mail.platform.test', workspaceB)).toBe(true)
    expect(isSendingIdentityPermitted('beta+c123.sig@mail.platform.test', workspaceB)).toBe(true)
    expect(isSendingIdentityPermitted('alpha@mail.platform.test', workspaceB)).toBe(false)
    expect(isSendingIdentityPermitted('alpha+c123.sig@mail.platform.test', workspaceB)).toBe(false)
    // The grant is to that domain itself and not to its subtree: a verified
    // domain covers its subdomains because a token was published inside it, and
    // no such token was published for this one.
    expect(isSendingIdentityPermitted('beta@sub.mail.platform.test', workspaceB)).toBe(false)
    expect(isSendingIdentityPermitted('beta@mail.platform.test.evil.test', workspaceB)).toBe(false)
  })

  it('permits the platform default sender by address, never by domain', () => {
    expect(isSendingIdentityPermitted('notifications@mail.platform.test', workspaceB)).toBe(true)
    // Same domain, different local part: minting on the platform's brand is the
    // exact thing matching by domain would have allowed.
    expect(isSendingIdentityPermitted('security@mail.platform.test', workspaceB)).toBe(false)
  })

  it('refuses when the workspace has no slug to be recognised by', () => {
    const unscoped = { ...workspaceB, mailSlug: null }
    expect(isSendingIdentityPermitted('beta@mail.platform.test', unscoped)).toBe(false)
  })

  it('permits anything on a single-workspace install', () => {
    // One workspace, one provider account, nobody to impersonate. Refusing here
    // would break a self-hosted install whose operator typed every address by
    // hand, to defend against a second workspace that does not exist.
    const selfHosted = { ...workspaceB, pooled: false }
    expect(isSendingIdentityPermitted('anything@wherever.test', selfHosted)).toBe(true)
    // And on a fleet the same address is refused.
    expect(isSendingIdentityPermitted('anything@wherever.test', workspaceB)).toBe(false)
  })

  it('refuses a value that is not an address at all', () => {
    expect(isSendingIdentityPermitted('not-an-address', workspaceB)).toBe(false)
    expect(isSendingIdentityPermitted('', workspaceB)).toBe(false)
  })
})

describe('platformSendingDomains', () => {
  it('collects the default sender’s domain and the shared inbound domain', () => {
    expect(
      platformSendingDomains({
        EMAIL_FROM: 'Quackback <notifications@mail.platform.test>',
        EMAIL_INBOUND_DOMAIN: 'Inbound.Platform.Test',
      })
    ).toEqual(new Set(['mail.platform.test', 'inbound.platform.test']))
  })

  it('is empty when neither is configured', () => {
    expect(platformSendingDomains({})).toEqual(new Set())
  })

  it('collects every domain the platform receives on, not only the minting one', () => {
    // Read by the provisioning path to refuse a workspace that tries to claim a
    // platform domain as its own. A domain retired from minting is still one the
    // platform's mail arrives at, so this set only ever grows and the refusal
    // only ever tightens.
    expect(
      platformSendingDomains({
        EMAIL_FROM: 'Quackback <notifications@mail.platform.test>',
        EMAIL_INBOUND_DOMAIN: 'Inbound.Platform.Test',
        EMAIL_INBOUND_EXTRA_DOMAINS: 'Old.Platform.Test, older.platform.test',
      })
    ).toEqual(
      new Set([
        'mail.platform.test',
        'inbound.platform.test',
        'old.platform.test',
        'older.platform.test',
      ])
    )
  })
})

describe('an internationalised domain is one domain, not two', () => {
  // A customer types their domain in its own script and the reply is addressed
  // in the A-label form (or the other way round). The two spellings never match
  // as strings, so without normalisation a workspace would be refused an
  // address it had genuinely verified — and the refusal is silent, because the
  // send path falls back to the platform sender rather than failing.
  const idn: SendingIdentityContext = { ...workspaceB, verifiedDomains: ['münchen.example'] }

  it('permits the A-label spelling of a domain verified in unicode', () => {
    expect(isSendingIdentityPermitted('support@xn--mnchen-3ya.example', idn)).toBe(true)
  })

  it('permits the unicode spelling of a domain verified as an A-label', () => {
    const ascii = { ...workspaceB, verifiedDomains: ['xn--mnchen-3ya.example'] }
    expect(isSendingIdentityPermitted('support@münchen.example', ascii)).toBe(true)
  })

  it('still covers subdomains, and still covers nothing else', () => {
    expect(isSendingIdentityPermitted('billing@mail.münchen.example', idn)).toBe(true)
    expect(isSendingIdentityPermitted('support@münchen.example.evil.test', idn)).toBe(false)
    expect(isSendingIdentityPermitted('support@münster.example', idn)).toBe(false)
  })

  it('normalises to one spelling, and does not turn a bad value into an empty one', () => {
    expect(toAsciiDomain('MÜNCHEN.Example.')).toBe('xn--mnchen-3ya.example')
    expect(toAsciiDomain('xn--mnchen-3ya.example')).toBe('xn--mnchen-3ya.example')
    // An empty result would match another empty result, so a value that cannot
    // be converted keeps its own text and fails the comparison instead.
    expect(toAsciiDomain('')).toBe('')
    expect(toAsciiDomain('not a domain')).toBe('not a domain')
  })
})

/**
 * WHICH configuration value the guard is wired to, which is a different question
 * from what the rule says.
 *
 * The rule is pure and reads one domain. What decides whether a retired inbound
 * domain grants a workspace the right to send from its own label is the wiring
 * above it, and the two look identical from inside the rule.
 */
describe('withSendingDisplayName', () => {
  it('wraps a bare address with a quoted display name when needed', () => {
    const named = withSendingDisplayName('support@acme.com' as SendingIdentity, 'Alex (Acme)')
    expect(named).toBe('"Alex (Acme)" <support@acme.com>')
  })

  it('replaces an existing display name without changing the addr-spec', () => {
    const named = withSendingDisplayName(
      'Support <support@acme.com>' as SendingIdentity,
      'Alex (Acme)'
    )
    expect(named).toBe('"Alex (Acme)" <support@acme.com>')
  })
})

describe('the send guard reads the minting domain, not the accept-set', () => {
  const env = {
    QUACKBACK_TENANCY: 'pooled',
    EMAIL_FROM: 'Quackback <notifications@mail.platform.test>',
    EMAIL_INBOUND_DOMAIN: 'mail.platform.test',
    EMAIL_INBOUND_EXTRA_DOMAINS: 'old.platform.test',
  }

  const permitted = (from: string): Promise<string | null> => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    // `neon-t1` reduces to the mail slug `neon-t1`, which is the label these
    // addresses carry.
    return withWorkspace('neon-t1', () => permittedSendingIdentity(from))
  }

  it('permits this workspace’s label on the minting domain', async () => {
    await expect(permitted('neon-t1@mail.platform.test')).resolves.toBe(
      'neon-t1@mail.platform.test'
    )
  })

  it('refuses it on a domain the fleet only RECEIVES on', async () => {
    // Widening the guard to the accept-set would permit this — and the send
    // would then be rejected by the provider, which holds no verified identity
    // for a domain retired from minting. Refused here, the caller falls back to
    // the platform sender and the mail goes out.
    await expect(permitted('neon-t1@old.platform.test')).resolves.toBeNull()
  })

  it('refuses another workspace’s label on either of them', async () => {
    await expect(permitted('neon-t2@mail.platform.test')).resolves.toBeNull()
    await expect(permitted('neon-t2@old.platform.test')).resolves.toBeNull()
  })
})
