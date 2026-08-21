import { describe, it, expect } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'
import {
  isEmailInboundConfigured,
  isEmailInboundWebhookConfigured,
  inboundReplyToAddress,
  inboundTicketReplyToAddress,
  conversationIdFromInboundAddress,
  ticketIdFromInboundAddress,
  signConversationId,
  signTicketId,
  bearsTicketMarker,
  isOwnInboundAddress,
  workspaceSlugFromInboundAddress,
  isValidMailSlug,
  InvalidMailSlugError,
  InvalidInboundAddressError,
  MAX_MAIL_SLUG_LENGTH,
  mintOutboundMessageId,
  mintNoteOutboundMessageId,
  noteThreadRootMessageId,
  teamThreadRootMessageId,
  mintTeamOutboundMessageId,
  ticketRootMessageId,
  outboundMessageIdDomain,
  ownEmailDomains,
  ownMessageIdDomains,
  inboundAcceptDomains,
  inboundMintDomain,
  invalidInboundDomainValues,
  platformInboxAddress,
  isPlatformInboxRecipient,
} from '../conversation.email-channel'

// 'whsec_' + base64('testsecret') / base64('othersecret').
const ENV = {
  EMAIL_INBOUND_DOMAIN: 'tenaevexeo.resend.app',
  EMAIL_INBOUND_SIGNING_SECRET: 'whsec_dGVzdHNlY3JldA==',
}
const OTHER_ENV = { ...ENV, EMAIL_INBOUND_SIGNING_SECRET: 'whsec_b3RoZXJzZWNyZXQ=' }

// A short stand-in id for the string mechanics, and a real id: the
// `conversation_` prefix plus a full 26-char TypeID suffix whose full local part
// used to overflow the RFC 5321 limit; see #293.
const ID = 'conversation_abc' as ConversationId
const REAL_ID = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId
const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q' as TicketId
const SLUG = 'ws-t1'

const localPartOf = (address: string) => address.slice(0, address.indexOf('@'))

/**
 * The same address with one character of its TAG changed, and nothing else.
 *
 * The tag is bounded by the last dot of the LOCAL PART, never of the address —
 * the domain is full of dots, and a helper that took the last one produced a
 * string that failed for the wrong reason and would have passed against code
 * doing no verification at all.
 */
function withTamperedTag(address: string): string {
  const at = address.indexOf('@')
  const local = address.slice(0, at)
  const dot = local.lastIndexOf('.')
  const tag = local.slice(dot + 1)
  const flipped = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`
  return `${local.slice(0, dot + 1)}${flipped}${address.slice(at)}`
}

describe('isEmailInboundConfigured', () => {
  it('is true only when both the inbound domain and signing secret are set', () => {
    expect(isEmailInboundConfigured({})).toBe(false)
    expect(isEmailInboundConfigured({ EMAIL_INBOUND_DOMAIN: 'x.resend.app' })).toBe(false)
    expect(isEmailInboundConfigured({ EMAIL_INBOUND_SIGNING_SECRET: 'whsec_1' })).toBe(false)
    expect(
      isEmailInboundConfigured({
        EMAIL_INBOUND_DOMAIN: 'x.resend.app',
        EMAIL_INBOUND_SIGNING_SECRET: 'whsec_1',
      })
    ).toBe(true)
  })
})

/**
 * The two halves of a domain change, and the fact that they are two.
 *
 * A reply address is minted once and read for as long as the mail it travelled
 * in survives, so the set of domains the front door must ANSWER for is a
 * superset of the one addresses are minted on — and it only ever grows. One
 * value serving both would make a domain change a cliff: the instant it moved,
 * every address minted before it started arriving at a door that refuses it.
 */
describe('inboundAcceptDomains', () => {
  it('is exactly the minting domain when no extras are configured', () => {
    // The self-hosted install, and the behaviour every deployment had before
    // the extras existed.
    expect(inboundAcceptDomains({ EMAIL_INBOUND_DOMAIN: 'in.example' })).toEqual(
      new Set(['in.example'])
    )
    expect(
      inboundAcceptDomains({ EMAIL_INBOUND_DOMAIN: 'in.example', EMAIL_INBOUND_EXTRA_DOMAINS: '' })
    ).toEqual(new Set(['in.example']))
    expect(inboundAcceptDomains({})).toEqual(new Set())
  })

  it('adds the extras to the minting domain rather than replacing it', () => {
    expect(
      inboundAcceptDomains({
        EMAIL_INBOUND_DOMAIN: 'in.example',
        EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example',
      })
    ).toEqual(new Set(['in.example', 'old.example']))
  })

  it('reads a list separated by commas, whitespace or both', () => {
    for (const extras of [
      'old.example,older.example',
      'old.example, older.example',
      'old.example older.example',
      '  old.example ,, older.example  ',
    ]) {
      expect(
        inboundAcceptDomains({
          EMAIL_INBOUND_DOMAIN: 'in.example',
          EMAIL_INBOUND_EXTRA_DOMAINS: extras,
        }),
        extras
      ).toEqual(new Set(['in.example', 'old.example', 'older.example']))
    }
  })

  it('folds every entry the way the front door compares a domain', () => {
    // A receiving mail server treats a domain case-insensitively, so a set
    // holding the other spelling would refuse mail addressed correctly.
    expect(
      inboundAcceptDomains({
        EMAIL_INBOUND_DOMAIN: ' In.Example ',
        EMAIL_INBOUND_EXTRA_DOMAINS: ' OLD.Example ',
      })
    ).toEqual(new Set(['in.example', 'old.example']))
  })

  it('normalises every entry the way every other reader does', () => {
    // ONE VALUE, ONE NORMALISATION. A set that repaired a spelling the minter
    // left raw would answer for a domain no address was built on, and the
    // internationalised case is the one where that is not merely untidy: a mail
    // server delivers the A-label form and nothing else, so a set holding the
    // unicode form refuses the only spelling that can ever arrive.
    expect(
      inboundAcceptDomains({
        EMAIL_INBOUND_DOMAIN: 'in.example.',
        EMAIL_INBOUND_EXTRA_DOMAINS: 'münchen.example',
      })
    ).toEqual(new Set(['in.example', 'xn--mnchen-3ya.example']))

    // ...and the minted address is built on that same spelling.
    expect(
      inboundReplyToAddress(REAL_ID, SLUG, {
        ...ENV,
        EMAIL_INBOUND_DOMAIN: ' In.Example. ',
      })
    ).toContain('@in.example')
  })

  it('refuses a minting domain that names more than one domain', () => {
    // THE CUTOVER TYPO. One value, one meaning: a comma here used to be spent
    // verbatim in both directions — an address minted `…@a.example,b.example`
    // that no mail server will ever deliver to, and an accept-set holding that
    // one string, which no envelope can ever match. Both silently wrong, and the
    // channel still reporting itself configured.
    const env = {
      EMAIL_INBOUND_DOMAIN: 'a.example,b.example',
      EMAIL_INBOUND_SIGNING_SECRET: ENV.EMAIL_INBOUND_SIGNING_SECRET,
    }

    expect(inboundAcceptDomains(env)).toEqual(new Set())
    expect(inboundMintDomain(env)).toBeNull()
    // Nothing is minted on it, so no reply address goes out carrying it...
    expect(inboundReplyToAddress(REAL_ID, SLUG, env)).toBeNull()
    expect(inboundTicketReplyToAddress(TICKET_ID, SLUG, env)).toBeNull()
    // ...and the channel reports what is true, which is that it is not usable.
    expect(isEmailInboundConfigured(env)).toBe(false)
    // The provider webhook's door stays OPEN on the same value, deliberately.
    // It 404s when it answers false, and a 404 there is a notification the
    // provider retries for a while and then abandons — a message discarded over
    // a variable that decides nothing about routing an arriving one. What the
    // typo costs is the Reply-To, which is the smaller loss.
    expect(isEmailInboundWebhookConfigured(env)).toBe(true)
    // Said out loud, naming the variable and the value an operator typed.
    expect(invalidInboundDomainValues(env)).toEqual([
      { variable: 'EMAIL_INBOUND_DOMAIN', value: 'a.example,b.example' },
    ])
  })

  it('refuses an extras entry that is not a domain, and keeps the ones that are', () => {
    // A typo in one entry must not cost the entries beside it: those are
    // domains real reply addresses are sitting on.
    const env = {
      EMAIL_INBOUND_DOMAIN: 'in.example',
      EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example,not_a_domain!,localhost,older.example',
    }

    expect(inboundAcceptDomains(env)).toEqual(
      new Set(['in.example', 'old.example', 'older.example'])
    )
    expect(invalidInboundDomainValues(env)).toEqual([
      { variable: 'EMAIL_INBOUND_EXTRA_DOMAINS', value: 'not_a_domain!' },
      { variable: 'EMAIL_INBOUND_EXTRA_DOMAINS', value: 'localhost' },
    ])
  })

  it('reports nothing for a configuration with nothing wrong with it', () => {
    expect(invalidInboundDomainValues({})).toEqual([])
    expect(invalidInboundDomainValues({ EMAIL_INBOUND_DOMAIN: '  ' })).toEqual([])
    expect(
      invalidInboundDomainValues({
        EMAIL_INBOUND_DOMAIN: 'in.example',
        EMAIL_INBOUND_EXTRA_DOMAINS: ' old.example ,, MÜNCHEN.example ',
      })
    ).toEqual([])
  })

  it('is not a suffix rule', () => {
    // The workspace label is unique only inside the zone it was minted under.
    const set = inboundAcceptDomains({
      EMAIL_INBOUND_DOMAIN: 'in.example',
      EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example',
    })
    expect(set.has('sub.old.example')).toBe(false)
    expect(set.has('old.example.evil.test')).toBe(false)
  })
})

describe('minting an inbound address', () => {
  it('mints on the minting domain alone, whatever else is accepted', () => {
    // The other half of the asymmetry. Extras widen what is RECEIVED and must
    // never move where an address is BUILT — a list whose first entry minted
    // would make a domain change a reorder, where a typo silently moves minting.
    const withExtras = { ...ENV, EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example,older.example' }

    expect(inboundReplyToAddress(REAL_ID, SLUG, withExtras)).toBe(
      inboundReplyToAddress(REAL_ID, SLUG, ENV)
    )
    expect(inboundReplyToAddress(REAL_ID, SLUG, withExtras)).toContain('@tenaevexeo.resend.app')
    expect(inboundTicketReplyToAddress(TICKET_ID, SLUG, withExtras)).toContain(
      '@tenaevexeo.resend.app'
    )
    // ...and the outbound Message-ID host with it.
    expect(outboundMessageIdDomain(withExtras)).toBe('tenaevexeo.resend.app')
    // Extras alone are not an inbound channel: there is nothing to mint on.
    expect(
      isEmailInboundConfigured({
        EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example',
        EMAIL_INBOUND_SIGNING_SECRET: ENV.EMAIL_INBOUND_SIGNING_SECRET,
      })
    ).toBe(false)
  })

  it('builds a signed plus-address carrying the slug and the family marker', () => {
    expect(inboundReplyToAddress(REAL_ID, SLUG, ENV)).toMatch(
      /^ws-t1\+c01kw8qxn1eeh4t2rek7varh032\.[A-Za-z0-9_-]{22}@tenaevexeo\.resend\.app$/
    )
    expect(inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)).toMatch(
      /^ws-t1\+t01h455vb4pex5vsknk084sn02q\.[A-Za-z0-9_-]{22}@tenaevexeo\.resend\.app$/
    )
  })

  // The grammar has one reading, so a caller with no workspace label has no
  // address to give out — not a second, label-free form to fall back to.
  it('returns null when the caller has no mail slug', () => {
    expect(inboundReplyToAddress(REAL_ID, null, ENV)).toBeNull()
    expect(inboundTicketReplyToAddress(TICKET_ID, null, ENV)).toBeNull()
  })

  it('returns null when the inbound domain or signing secret is missing', () => {
    expect(inboundReplyToAddress(ID, SLUG, {})).toBeNull()
    expect(
      inboundReplyToAddress(ID, SLUG, { EMAIL_INBOUND_DOMAIN: 'tenaevexeo.resend.app' })
    ).toBeNull()
    expect(inboundTicketReplyToAddress(TICKET_ID, SLUG, {})).toBeNull()
  })

  it('embeds the bare TypeID suffix, not the redundant conversation_ prefix', () => {
    expect(localPartOf(inboundReplyToAddress(REAL_ID, SLUG, ENV)!)).not.toContain('conversation_')
  })
})

describe('reading an inbound address back', () => {
  it('round-trips both families', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(conversationIdFromInboundAddress(conv, ENV)).toBe(REAL_ID)
    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(ticketIdFromInboundAddress(ticket, ENV)).toBe(TICKET_ID)
  })

  it('tolerates a display-name wrapper and preserves the base64url tag case', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(conversationIdFromInboundAddress(`Support <${conv}>`, ENV)).toBe(REAL_ID)
  })

  it('reads a slug back case-insensitively, as a receiving server may fold it', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(conversationIdFromInboundAddress(conv.replace('ws-t1+', 'Ws-T1+'), ENV)).toBe(REAL_ID)
  })

  it('rejects a tampered tag', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(
      conversationIdFromInboundAddress(conv.replace(/\.[^@]+@/, '.AAAAAAAAAAAAAAAAAAAAAA@'), ENV)
    ).toBeNull()
    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(
      ticketIdFromInboundAddress(ticket.replace(/\.[^@]+@/, '.AAAAAAAAAAAAAAAAAAAAAA@'), ENV)
    ).toBeNull()
  })

  it('rejects a tampered id whose tag no longer matches', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(conversationIdFromInboundAddress(conv.replace('+c01kw', '+c02kw'), ENV)).toBeNull()
  })

  it('rejects a tag minted with a different secret', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(conversationIdFromInboundAddress(conv, OTHER_ENV)).toBeNull()
  })

  it('rejects an unsigned plus-address', () => {
    expect(conversationIdFromInboundAddress('ws-t1+c01kw8qxn1eeh4t2rek7varh032@x', ENV)).toBeNull()
  })

  it('returns null for a non-plus-addressed recipient', () => {
    expect(conversationIdFromInboundAddress('bob@example.com', ENV)).toBeNull()
    expect(conversationIdFromInboundAddress('ws-t1@tenaevexeo.resend.app', ENV)).toBeNull()
  })

  it('keeps the two families disjoint', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(ticketIdFromInboundAddress(conv, ENV)).toBeNull()
    expect(conversationIdFromInboundAddress(ticket, ENV)).toBeNull()
  })
})

/**
 * The tag covers the workspace as well as the id. The signing secret is
 * fleet-wide, so a tag over the id alone would keep verifying beside any slug —
 * one leaked reply address would then be a fleet-wide capability wearing a
 * workspace-shaped label.
 */
describe('the tag binds the slug, not just the id', () => {
  it('does not verify once the slug beside a genuine tag is rewritten', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    const reslugged = conv.replace('ws-t1+', 'ws-t2+')
    expect(conversationIdFromInboundAddress(reslugged, ENV)).toBeNull()
    // ...and the address that WOULD be right for that workspace has a different
    // tag, so the two are not interchangeable in either direction.
    expect(reslugged).not.toBe(inboundReplyToAddress(REAL_ID, 'ws-t2', ENV))

    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(ticketIdFromInboundAddress(ticket.replace('ws-t1+', 'ws-t2+'), ENV)).toBeNull()
  })

  it('signs the same id to a different tag under a different slug', () => {
    expect(signConversationId(REAL_ID, 'ws-t1', ENV)).not.toBe(
      signConversationId(REAL_ID, 'ws-t2', ENV)
    )
    expect(signTicketId(TICKET_ID, 'ws-t1', ENV)).not.toBe(signTicketId(TICKET_ID, 'ws-t2', ENV))
  })

  it('gives a local part that is not a usable slug no reading at all', () => {
    // Even holding a correct tag for the label it names, an address whose label
    // this grammar could never mint is not a workspace address.
    const tag = signConversationId(REAL_ID, 'not_a_slug', ENV)
    expect(
      conversationIdFromInboundAddress(
        `NOT_A_SLUG+c01kw8qxn1eeh4t2rek7varh032.${tag}@tenaevexeo.resend.app`,
        ENV
      )
    ).toBeNull()
  })
})

/**
 * There is no second grammar. Addresses shaped like the pre-slug `reply+…` form
 * name no workspace and carry no tag over one, so nothing reads them — pinned
 * here so the branch cannot be quietly reintroduced. What a reply to one of
 * those does instead is documented on the module: it threads by stored
 * Message-ID if it can, and otherwise arrives as cold inbound.
 */
describe('the pre-slug grammar is not recognised', () => {
  it('does not route a pre-slug conversation address', () => {
    const suffix = REAL_ID.replace(/^conversation_/, '')
    for (const tag of [
      signConversationId(REAL_ID, 'reply', ENV),
      signConversationId(REAL_ID, '', ENV),
    ]) {
      expect(
        conversationIdFromInboundAddress(`reply+${suffix}.${tag}@tenaevexeo.resend.app`, ENV)
      ).toBeNull()
    }
  })

  it('does not route a pre-slug ticket address, nor claim it as ticket-destined', () => {
    const suffix = TICKET_ID.replace(/^ticket_/, '')
    const legacy = `reply+tkt-${suffix}.${signTicketId(TICKET_ID, 'reply', ENV)}@tenaevexeo.resend.app`
    expect(ticketIdFromInboundAddress(legacy, ENV)).toBeNull()
    expect(conversationIdFromInboundAddress(legacy, ENV)).toBeNull()
    expect(bearsTicketMarker(legacy)).toBe(false)
  })

  it('does not route an address embedding the full prefixed id', () => {
    // The pre-#293 form carried `conversation_<suffix>` in the local part.
    expect(
      conversationIdFromInboundAddress(
        `ws-t1+c${REAL_ID}.${signConversationId(REAL_ID, SLUG, ENV)}@tenaevexeo.resend.app`,
        ENV
      )
    ).toBeNull()
  })

  it('treats `reply` as an ordinary slug, with no special meaning left', () => {
    expect(isValidMailSlug('reply')).toBe(true)
    const addr = inboundReplyToAddress(REAL_ID, 'reply', ENV)!
    expect(addr).toMatch(/^reply\+c01kw8qxn1eeh4t2rek7varh032\./)
    expect(conversationIdFromInboundAddress(addr, ENV)).toBe(REAL_ID)
  })
})

/**
 * The budget is the whole design constraint: RFC 5321 caps a local part at 64,
 * everything after the slug spends 51, and the slug gets what is left.
 */
describe('the local-part budget', () => {
  it('derives the slug ceiling from the RFC 5321 limit', () => {
    expect(MAX_MAIL_SLUG_LENGTH).toBe(13)
  })

  it('lands a maximum-length slug on exactly 64 characters of local part', () => {
    const slug = 'a'.repeat(MAX_MAIL_SLUG_LENGTH)
    expect(localPartOf(inboundReplyToAddress(REAL_ID, slug, ENV)!)).toHaveLength(64)
    expect(localPartOf(inboundTicketReplyToAddress(TICKET_ID, slug, ENV)!)).toHaveLength(64)
  })

  it('refuses to mint an address for an over-length slug', () => {
    const slug = 'a'.repeat(MAX_MAIL_SLUG_LENGTH + 1)
    expect(() => inboundReplyToAddress(REAL_ID, slug, ENV)).toThrow(InvalidMailSlugError)
    expect(() => inboundTicketReplyToAddress(TICKET_ID, slug, ENV)).toThrow(InvalidMailSlugError)
    // Loud wherever it is configured, not only where inbound email is wired up.
    expect(() => inboundReplyToAddress(REAL_ID, slug, {})).toThrow(InvalidMailSlugError)
  })

  it('refuses a slug that is not lower-case, digits and hyphen', () => {
    for (const slug of ['Ws-T1', 'ws_t1', 'ws t1', 'ws.t1', 'ws+t1', '']) {
      expect(isValidMailSlug(slug)).toBe(false)
      expect(() => inboundReplyToAddress(REAL_ID, slug, ENV)).toThrow(InvalidMailSlugError)
    }
    for (const slug of ['a', 'ws-t1', '0', 'a'.repeat(MAX_MAIL_SLUG_LENGTH)]) {
      expect(isValidMailSlug(slug)).toBe(true)
    }
  })

  // The slug is bounded by assertion; so is everything else that goes in beside
  // it. Both cases are unreachable from a branded id, which is why they cost one
  // comparison each rather than a redesign.
  it('refuses an id that does not carry its constant prefix', () => {
    expect(() =>
      inboundReplyToAddress('ticket_01h455vb4pex5vsknk084sn02q' as never, SLUG, ENV)
    ).toThrow(InvalidInboundAddressError)
    expect(() => inboundTicketReplyToAddress(REAL_ID as never, SLUG, ENV)).toThrow(
      InvalidInboundAddressError
    )
  })

  it('refuses an id whose suffix would push the local part over the limit', () => {
    const oversized = `conversation_${'a'.repeat(40)}` as ConversationId
    expect(() => inboundReplyToAddress(oversized, SLUG, ENV)).toThrow(InvalidInboundAddressError)
  })
})

/**
 * The routing label a shared front door reads first. Two states, and they are
 * distinct on purpose: `unreadable` is a local part this grammar cannot mint,
 * which on a shared inbound domain is a stranger's address or an attempt at one.
 * A caller must never fold it in with a legitimate reading and allow it.
 */
describe('workspaceSlugFromInboundAddress', () => {
  it('reads the label out of either family', () => {
    expect(workspaceSlugFromInboundAddress(inboundReplyToAddress(REAL_ID, SLUG, ENV)!)).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
    expect(
      workspaceSlugFromInboundAddress(inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!)
    ).toEqual({ kind: 'slug', slug: SLUG })
  })

  it('reads a bare support address as the workspace it names', () => {
    // `<slug>@<domain>` is the cold-inbound row of the grammar, so the whole
    // local part is the label.
    expect(workspaceSlugFromInboundAddress('ws-t1@in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
  })

  it('folds case, as a receiving server may', () => {
    expect(workspaceSlugFromInboundAddress('Ws-T1+c01kw.sig@in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
  })

  it('reads exactly what the edge reader read before it chose a host', () => {
    // The label decides which workspace's database a stranger's mail may reach,
    // and it is read twice: once at the edge to pick a host, once at that host
    // to accept the delivery. The two readings have to be the same reading, so
    // the whitespace and the last-`@` rules are pinned here rather than left to
    // whichever caller happens to depend on them.
    expect(workspaceSlugFromInboundAddress('  ws-t1  @in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
    expect(workspaceSlugFromInboundAddress('ws-t1+@in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
    // Split on the FIRST `@` and this reads as ours. It is not ours.
    expect(workspaceSlugFromInboundAddress('ws-t1@evil.test@in.example')).toEqual({
      kind: 'unreadable',
    })
  })

  it('reports a label this grammar cannot mint as unreadable, never as absent', () => {
    for (const address of [
      'NOT_A_SLUG!!+c01kw8qxn1eeh4t2rek7varh032.sig@in.example',
      'a.very.long.customer.local.part@example.com',
      'not-an-address-at-all',
      // A value with no `@` at all whose last character is what stands between
      // it and a legal label. Reading it as a local part would answer `ws-t1`
      // — one character off a real workspace — so this is the case that pins the
      // no-`@` guard rather than leaning on the vocabulary to catch it.
      'ws-t1x',
      'ws-t1',
      // An empty local part, which the vocabulary refuses on its own (see the
      // slug tests): the guard above it is redundant here, deliberately, and
      // this case does not pretend to pin it.
      '@in.example',
      '',
      // One address, never a header: a value carrying several is not an
      // envelope, and the one that routed the mail is not identifiable in it.
      'stranger@example.com, ws-t1@in.example',
      '<ws-t1@in.example>',
    ]) {
      expect(workspaceSlugFromInboundAddress(address), address).toEqual({ kind: 'unreadable' })
    }
  })
})

/**
 * The address a workspace has before anybody configures anything. Every case
 * here is a way of getting it wrong that would be SILENT in production: an
 * address on a domain with no sending identity behind it, an address minted out
 * of a value that names no domain, an address for a workspace that cannot be
 * named, or a neighbour's mail read as our own.
 */
describe('the platform inbox', () => {
  const EXTRAS = { ...ENV, EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example' }

  it('is the bare support address on the MINTING domain', () => {
    expect(platformInboxAddress(SLUG, ENV)).toBe(`${SLUG}@tenaevexeo.resend.app`)
    // Reads back through the same parser the front door reads a delivery with,
    // so the address written down is one the door answers for.
    expect(workspaceSlugFromInboundAddress(platformInboxAddress(SLUG, ENV)!)).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
  })

  it('is never minted on an extra domain, however many are listed', () => {
    // An extra is received on and has no verified sending identity behind it, so
    // an address built there is a From the provider refuses. Adding one must not
    // move where the workspace's own address lives.
    expect(platformInboxAddress(SLUG, EXTRAS)).toBe(`${SLUG}@tenaevexeo.resend.app`)
  })

  it('is nothing at all when the mint domain names no domain', () => {
    // The refusal `inboundMintDomain` makes is the point: it disables inbound
    // rather than corrupting it, and a default address must not paper over it by
    // inventing one. The typo below is the one a cutover invites.
    expect(
      platformInboxAddress(SLUG, { ...ENV, EMAIL_INBOUND_DOMAIN: 'a.example,b.example' })
    ).toBe(null)
    expect(platformInboxAddress(SLUG, { ...ENV, EMAIL_INBOUND_DOMAIN: '' })).toBe(null)
    expect(platformInboxAddress(SLUG, { EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example' })).toBe(null)
  })

  it('is nothing at all for a workspace with no usable mail slug', () => {
    expect(platformInboxAddress(null, ENV)).toBe(null)
    // A malformed slug answers null rather than throwing, because this is read
    // on the path an arriving message takes and a throw there is a redelivery
    // loop. The loud refusal still exists on the minting path.
    expect(platformInboxAddress('NOT_A_SLUG!!', ENV)).toBe(null)
    expect(() => inboundReplyToAddress(REAL_ID, 'NOT_A_SLUG!!', ENV)).toThrow(InvalidMailSlugError)
  })

  it('recognises mail to the address, sub-addressed or not', () => {
    expect(isPlatformInboxRecipient(`${SLUG}@tenaevexeo.resend.app`, SLUG, ENV)).toBe(true)
    // Case folded and padded, as a receiving server may present it.
    expect(
      isPlatformInboxRecipient(`  ${SLUG.toUpperCase()}@Tenaevexeo.Resend.App `, SLUG, ENV)
    ).toBe(true)
    // Ordinary sub-addressing a customer does for their own filing.
    expect(isPlatformInboxRecipient(`${SLUG}+tuesday@tenaevexeo.resend.app`, SLUG, ENV)).toBe(true)
    // A reply address whose tag did NOT verify reaches cold inbound; it is mail
    // to this workspace's support address and opens a new thread rather than
    // being dropped.
    expect(
      isPlatformInboxRecipient(
        `${SLUG}+c01kw8qxn1eeh4t2rek7varh032.AAAAAAAAAAAAAAAAAAAAAA@tenaevexeo.resend.app`,
        SLUG,
        ENV
      )
    ).toBe(true)
  })

  it('recognises the address inside a display name, which is how a To header carries one', () => {
    // What the readers upstream actually hand this: `headerAddresses` (raw MIME
    // and IMAP) and `addressArray` (a provider webhook payload) both pass an
    // address-list ENTRY through untouched, so a header written the ordinary way
    // arrives here still wearing its display name. Reading only the bare form
    // drops that mail, and IMAP is the door where a display-name `To` is normal.
    expect(
      isPlatformInboxRecipient(`"Acme Support" <${SLUG}@tenaevexeo.resend.app>`, SLUG, ENV)
    ).toBe(true)
    expect(
      isPlatformInboxRecipient(`Acme Support <${SLUG}@tenaevexeo.resend.app>`, SLUG, ENV)
    ).toBe(true)
    // A whole header line, which is one string when a provider hands `to` over
    // unsplit. Ours is not the first address in it.
    expect(
      isPlatformInboxRecipient(
        `Someone <someone@acme.com>, "Acme Support" <${SLUG}@tenaevexeo.resend.app>`,
        SLUG,
        ENV
      )
    ).toBe(true)
    // The same forms for a neighbour stay refused: the reading widens what is
    // PARSED, never what matches.
    expect(
      isPlatformInboxRecipient('"Acme Support" <ws-t2@tenaevexeo.resend.app>', SLUG, ENV)
    ).toBe(false)
    expect(isPlatformInboxRecipient(`Support <${SLUG}@evil.test>`, SLUG, ENV)).toBe(false)
  })

  it('still recognises the address on a domain retired from minting', () => {
    // The asymmetry the extras exist for: an address is published once and
    // written to for as long as anyone has it. Recognising it costs nothing,
    // while minting there would produce a From with no identity behind it.
    expect(isPlatformInboxRecipient(`${SLUG}@old.example`, SLUG, EXTRAS)).toBe(true)
    expect(isPlatformInboxRecipient(`${SLUG}@old.example`, SLUG, ENV)).toBe(false)
  })

  it('does not recognise a neighbour, a stranger, or any other domain', () => {
    // The signing secret and the inbound domain are both fleet-wide, so the
    // label is the whole of what separates two workspaces. Reading a
    // neighbour's mail as ours writes a stranger's message into this database.
    expect(isPlatformInboxRecipient('ws-t2@tenaevexeo.resend.app', SLUG, ENV)).toBe(false)
    expect(isPlatformInboxRecipient(`${SLUG}@evil.test`, SLUG, ENV)).toBe(false)
    // A subdomain of an accepted domain is a different zone, and the label is
    // unique only inside the zone it was minted under.
    expect(isPlatformInboxRecipient(`${SLUG}@mail.tenaevexeo.resend.app`, SLUG, ENV)).toBe(false)
    expect(isPlatformInboxRecipient(`${SLUG}@tenaevexeo.resend.app`, null, ENV)).toBe(false)
    // Splitting on the FIRST `@` would read this as ours. It is not.
    expect(isPlatformInboxRecipient(`${SLUG}@evil.test@tenaevexeo.resend.app`, SLUG, ENV)).toBe(
      false
    )
  })
})

/**
 * The unauthenticated claim: does this recipient say it is ticket-destined? The
 * ingest core drops on it before any tag is checked, so a wrong answer either
 * way loses mail — a false positive drops a real customer's message before
 * conversation routing sees it, a false negative lets a forgery open a
 * conversation.
 */
describe('bearsTicketMarker', () => {
  it('claims a ticket address, verified or not', () => {
    expect(bearsTicketMarker(inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!)).toBe(true)
    // Same shape, wrong tag: still ticket-destined, so still dropped rather than
    // reinterpreted as a conversation reply or opened as cold inbound.
    expect(
      bearsTicketMarker('ws-t1+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@in.example')
    ).toBe(true)
  })

  it('does not claim a conversation address or a bare support address', () => {
    expect(bearsTicketMarker(inboundReplyToAddress(REAL_ID, SLUG, ENV)!)).toBe(false)
    expect(bearsTicketMarker('ws-t1@in.example')).toBe(false)
  })

  // A customer plus-addressing for their own filing is the common case, and
  // several of those begin with the marker character. Claiming one drops the
  // whole message: a single such recipient anywhere in a reply-all thread is
  // enough, and per-site filing conventions produce them constantly.
  it('does not claim ordinary sub-addressing that merely starts with the marker', () => {
    for (const address of [
      'ws-t1+tuesday@in.example',
      'ws-t1+twitter.com@in.example',
      'me+twitter.com@gmail.com',
      'colleague+twitter.com@gmail.com',
      'ws-t1+t.a@in.example',
      // Right lengths, wrong places: a 22-char suffix and a 26-char tag.
      'ws-t1+tAAAAAAAAAAAAAAAAAAAAAA.01h455vb4pex5vsknk084sn02q@in.example',
    ]) {
      expect(bearsTicketMarker(address)).toBe(false)
    }
  })

  it('does not claim a ticket-shaped address whose label is not a usable slug', () => {
    expect(
      bearsTicketMarker(
        'NOT_A_SLUG!!+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@in.example'
      )
    ).toBe(false)
  })

  it('scans every recipient in a header value', () => {
    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(bearsTicketMarker(`Someone <someone@example.com>, Support <${ticket}>`)).toBe(true)
  })
})

/**
 * "Did THIS workspace mint this address?" — the question the mail-loop guard
 * asks once the sending transport has taken the `Message-ID` away from us.
 *
 * Three things have to hold at once, and each closes a different door. The tag
 * has to verify, so the answer cannot be reached by writing an address down. The
 * label has to be this workspace's, because the secret is fleet-wide and a
 * neighbour's address verifies against it perfectly well. The domain has to be
 * one we receive on, because an address is only ours if we could have minted it.
 */
describe('isOwnInboundAddress', () => {
  it('recognises the conversation and ticket addresses this workspace mints', () => {
    expect(isOwnInboundAddress(inboundReplyToAddress(REAL_ID, SLUG, ENV)!, SLUG, ENV)).toBe(true)
    expect(isOwnInboundAddress(inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!, SLUG, ENV)).toBe(
      true
    )
  })

  it('reads one out of a header value with a display name beside other addresses', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(isOwnInboundAddress(`Jane <jane@example.com>, Support <${conv}>`, SLUG, ENV)).toBe(true)
  })

  it('refuses an address of ours whose tag was tampered with', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    const forged = withTamperedTag(conv)
    // Same address in every respect a shape test can see: same label, same id,
    // same domain, same 22-char base64url tag. Only the tag's VALUE differs, so
    // nothing short of the HMAC can tell the two apart.
    expect(forged).not.toBe(conv)
    expect(forged.length).toBe(conv.length)
    expect(conversationIdFromInboundAddress(forged, ENV)).toBeNull()
    expect(isOwnInboundAddress(forged, SLUG, ENV)).toBe(false)
  })

  it('refuses a neighbouring workspace’s address on the same fleet', () => {
    // The decisive one. The signing secret is fleet-wide, so this address is
    // genuinely well-formed and genuinely verifies — it just is not OURS, and a
    // guard that only asked "does the tag check out" would call a neighbour's
    // mail our own and hard-drop it.
    const neighbour = inboundReplyToAddress(REAL_ID, 'ws-t2', ENV)!
    expect(conversationIdFromInboundAddress(neighbour, ENV)).toBe(REAL_ID)
    expect(isOwnInboundAddress(neighbour, SLUG, ENV)).toBe(false)
  })

  it('refuses an address minted on a domain we do not receive on', () => {
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    const elsewhere = `${localPartOf(conv)}@attacker.test`
    expect(isOwnInboundAddress(elsewhere, SLUG, ENV)).toBe(false)
    // ...and a domain we have retired but still receive on stays ours.
    const retiredEnv = { ...ENV, EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example' }
    expect(isOwnInboundAddress(`${localPartOf(conv)}@old.example`, SLUG, retiredEnv)).toBe(true)
  })

  it('refuses an address signed with another install’s secret', () => {
    const theirs = inboundReplyToAddress(REAL_ID, SLUG, OTHER_ENV)!
    expect(isOwnInboundAddress(theirs, SLUG, ENV)).toBe(false)
  })

  it('refuses ordinary sub-addressing and a bare support address', () => {
    for (const address of [
      'ws-t1@tenaevexeo.resend.app',
      'ws-t1+tuesday@tenaevexeo.resend.app',
      'jane@example.com',
      'me+twitter.com@gmail.com',
    ]) {
      expect(isOwnInboundAddress(address, SLUG, ENV)).toBe(false)
    }
  })

  it('answers no when there is no workspace label and no secret to check against', () => {
    // Both are the guard's fail-open direction, stated here rather than left to
    // the caller: unrecognised means "not ours", which ingests the message. The
    // other direction would drop it, with nothing kept.
    const conv = inboundReplyToAddress(REAL_ID, SLUG, ENV)!
    expect(isOwnInboundAddress(conv, null, ENV)).toBe(false)
    expect(
      isOwnInboundAddress(conv, SLUG, { EMAIL_INBOUND_DOMAIN: ENV.EMAIL_INBOUND_DOMAIN })
    ).toBe(false)
  })
})

describe('outbound Message-ID threading', () => {
  const FROM_ENV = { EMAIL_FROM: 'Support <noreply@acme.example>' }

  it('derives the outbound host from EMAIL_FROM, falling back to the inbound domain', () => {
    expect(outboundMessageIdDomain(FROM_ENV)).toBe('acme.example')
    expect(outboundMessageIdDomain({ EMAIL_INBOUND_DOMAIN: 'x.resend.app' })).toBe('x.resend.app')
    expect(outboundMessageIdDomain({})).toBeNull()
  })

  it('mints a conversation-scoped Message-ID on our own domain (bare, no brackets)', () => {
    const id = mintOutboundMessageId(REAL_ID, FROM_ENV)!
    expect(id).toMatch(/^c\.01kw8qxn1eeh4t2rek7varh032\.[A-Za-z0-9_-]+@acme\.example$/)
    expect(id).not.toMatch(/[<>]/)
  })

  it('mints a fresh (unique) id each call', () => {
    expect(mintOutboundMessageId(REAL_ID, FROM_ENV)).not.toBe(
      mintOutboundMessageId(REAL_ID, FROM_ENV)
    )
  })

  it('returns null when no sending domain is configured', () => {
    expect(mintOutboundMessageId(REAL_ID, {})).toBeNull()
  })

  it('collects our own sending domains from EMAIL_FROM and the inbound domain', () => {
    const domains = ownEmailDomains({ ...FROM_ENV, EMAIL_INBOUND_DOMAIN: 'x.resend.app' })
    expect(domains).toEqual(new Set(['acme.example', 'x.resend.app']))
  })

  it('counts every domain we receive on as ours, not only the minting one', () => {
    // A notification sent before a domain change carries a Message-ID on the
    // domain that was minting then, and it is no less ours for having been
    // retired since. A set narrowed to the current minting domain would stop
    // recognising exactly the older mail most likely to still be circulating.
    //
    // The cost is stated where the set is built: this feeds a check whose branch
    // is a refusal with nothing retained, matching on the Message-ID domain
    // alone. Every member is therefore also a promise that no stranger's mail
    // carries a Message-ID on it — true of a zone we operate, and the reason the
    // extras list may only name one.
    const domains = ownEmailDomains({
      ...FROM_ENV,
      EMAIL_INBOUND_DOMAIN: 'x.resend.app',
      EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example',
    })
    expect(domains).toEqual(new Set(['acme.example', 'x.resend.app', 'old.example']))
  })

  it('claims a Message-ID host for a workspace only when the workspace owns it', () => {
    // The install's domains and THIS WORKSPACE's domains are the same set only
    // when the process serves one workspace. Pooled, every workspace's mail
    // leaves through the same sending domain, so a host names the fleet and not
    // the sender: read as authorship it refuses the neighbour's mail, which is
    // the same mistake as adopting a sending provider's regional host, one level
    // in. Nothing is given up by emptying it there, since ids are minted on that
    // shared domain and the fleet's transport replaces them anyway.
    const env = { ...FROM_ENV, EMAIL_INBOUND_DOMAIN: 'x.resend.app' }
    expect(ownMessageIdDomains(env)).toEqual(new Set(['acme.example', 'x.resend.app']))
    expect(ownMessageIdDomains({ ...env, QUACKBACK_TENANCY: 'pooled' })).toEqual(new Set())
    // The install-level set is unchanged by tenancy: it answers a different
    // question (what this process sends and receives on) and other readers
    // depend on that answer.
    expect(ownEmailDomains({ ...env, QUACKBACK_TENANCY: 'pooled' }).size).toBe(2)
  })

  it('holds every domain in the spelling a Message-ID actually arrives in', () => {
    // The comparison is against the host of an inbound Message-ID, which is
    // A-label ASCII because that is what a mail server puts on the wire. A set
    // holding the other spelling of the same zone recognises none of our own
    // mail coming back, which is the loop this check exists to catch.
    const domains = ownEmailDomains({
      EMAIL_FROM: 'Support <noreply@MÜNCHEN.example>',
      EMAIL_INBOUND_DOMAIN: 'IN.Example.',
      EMAIL_INBOUND_EXTRA_DOMAINS: 'Old.Example',
    })
    expect(domains).toEqual(new Set(['xn--mnchen-3ya.example', 'in.example', 'old.example']))
  })

  it('mints outbound ids on that same spelling', () => {
    expect(outboundMessageIdDomain({ EMAIL_FROM: 'Support <noreply@ACME.Example.>' })).toBe(
      'acme.example'
    )
    // A value that names no domain falls through to the next candidate rather
    // than becoming the host of every id we mint.
    expect(
      outboundMessageIdDomain({
        EMAIL_FROM: 'Support <noreply@localhost>',
        EMAIL_INBOUND_DOMAIN: 'in.example',
      })
    ).toBe('in.example')
    expect(outboundMessageIdDomain({ EMAIL_INBOUND_DOMAIN: 'a.example,b.example' })).toBeNull()
  })
})

describe('internal-note Message-ID threading', () => {
  const FROM_ENV = { EMAIL_FROM: 'Support <noreply@acme.example>' }

  it('derives a deterministic note-thread root for a conversation', () => {
    expect(noteThreadRootMessageId(REAL_ID, FROM_ENV)).toBe(
      'note.01kw8qxn1eeh4t2rek7varh032@acme.example'
    )
    expect(noteThreadRootMessageId(REAL_ID, FROM_ENV)).toBe(
      noteThreadRootMessageId(REAL_ID, FROM_ENV)
    )
  })

  it('mints a fresh per-send note Message-ID under the same root suffix', () => {
    const id = mintNoteOutboundMessageId(REAL_ID, FROM_ENV)!
    expect(id).toMatch(/^note\.01kw8qxn1eeh4t2rek7varh032\.[A-Za-z0-9_-]+@acme\.example$/)
    expect(id).not.toMatch(/[<>]/)
    expect(mintNoteOutboundMessageId(REAL_ID, FROM_ENV)).not.toBe(
      mintNoteOutboundMessageId(REAL_ID, FROM_ENV)
    )
  })

  it('keeps the note namespace disjoint from the customer-facing conversation ids', () => {
    const noteIds = [
      noteThreadRootMessageId(REAL_ID, FROM_ENV)!,
      mintNoteOutboundMessageId(REAL_ID, FROM_ENV)!,
    ]
    for (const id of noteIds) {
      expect(id).not.toMatch(/^c\./)
      expect(id).not.toBe(mintOutboundMessageId(REAL_ID, FROM_ENV))
    }
  })

  it('returns null when no sending domain is configured', () => {
    expect(noteThreadRootMessageId(REAL_ID, {})).toBeNull()
    expect(mintNoteOutboundMessageId(REAL_ID, {})).toBeNull()
  })
})

describe('team-alert Message-ID threading', () => {
  const FROM_ENV = { EMAIL_FROM: 'Support <noreply@acme.example>' }

  it('derives a deterministic team-thread root', () => {
    expect(teamThreadRootMessageId(REAL_ID, FROM_ENV)).toBe(
      'team.01kw8qxn1eeh4t2rek7varh032@acme.example'
    )
  })

  it('stays disjoint from customer and note namespaces', () => {
    const id = teamThreadRootMessageId(REAL_ID, FROM_ENV)!
    expect(id.startsWith('team.')).toBe(true)
    expect(id).not.toBe(noteThreadRootMessageId(REAL_ID, FROM_ENV))
    expect(mintTeamOutboundMessageId(REAL_ID, FROM_ENV)).toMatch(/^team\./)
  })
})

describe('ticket Message-ID threading', () => {
  const env = { ...ENV, EMAIL_FROM: 'noreply@acme.example.com' }

  it('derives a deterministic ticket-thread root', () => {
    expect(ticketRootMessageId(TICKET_ID, env)).toBe(
      'ticket-01h455vb4pex5vsknk084sn02q@acme.example.com'
    )
    expect(ticketRootMessageId(TICKET_ID, env)).toBe(ticketRootMessageId(TICKET_ID, env))
  })

  it('returns null when no sending domain is configured', () => {
    expect(ticketRootMessageId(TICKET_ID, {})).toBeNull()
  })
})
