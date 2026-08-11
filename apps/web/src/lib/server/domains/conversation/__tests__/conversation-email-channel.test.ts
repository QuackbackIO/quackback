import { describe, it, expect } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'
import {
  isEmailInboundConfigured,
  inboundReplyToAddress,
  inboundTicketReplyToAddress,
  conversationIdFromInboundAddress,
  ticketIdFromInboundAddress,
  signConversationId,
  signTicketId,
  bearsTicketMarker,
  workspaceSlugFromInboundAddress,
  isValidMailSlug,
  InvalidMailSlugError,
  InvalidInboundAddressError,
  MAX_MAIL_SLUG_LENGTH,
  mintOutboundMessageId,
  mintNoteOutboundMessageId,
  noteThreadRootMessageId,
  ticketRootMessageId,
  outboundMessageIdDomain,
  ownEmailDomains,
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
const SLUG = 'neon-t1'

const localPartOf = (address: string) => address.slice(0, address.indexOf('@'))

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

describe('minting an inbound address', () => {
  it('builds a signed plus-address carrying the slug and the family marker', () => {
    expect(inboundReplyToAddress(REAL_ID, SLUG, ENV)).toMatch(
      /^neon-t1\+c01kw8qxn1eeh4t2rek7varh032\.[A-Za-z0-9_-]{22}@tenaevexeo\.resend\.app$/
    )
    expect(inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)).toMatch(
      /^neon-t1\+t01h455vb4pex5vsknk084sn02q\.[A-Za-z0-9_-]{22}@tenaevexeo\.resend\.app$/
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
    expect(conversationIdFromInboundAddress(conv.replace('neon-t1+', 'Neon-T1+'), ENV)).toBe(
      REAL_ID
    )
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
    expect(
      conversationIdFromInboundAddress('neon-t1+c01kw8qxn1eeh4t2rek7varh032@x', ENV)
    ).toBeNull()
  })

  it('returns null for a non-plus-addressed recipient', () => {
    expect(conversationIdFromInboundAddress('bob@example.com', ENV)).toBeNull()
    expect(conversationIdFromInboundAddress('neon-t1@tenaevexeo.resend.app', ENV)).toBeNull()
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
    const reslugged = conv.replace('neon-t1+', 'neon-t2+')
    expect(conversationIdFromInboundAddress(reslugged, ENV)).toBeNull()
    // ...and the address that WOULD be right for that workspace has a different
    // tag, so the two are not interchangeable in either direction.
    expect(reslugged).not.toBe(inboundReplyToAddress(REAL_ID, 'neon-t2', ENV))

    const ticket = inboundTicketReplyToAddress(TICKET_ID, SLUG, ENV)!
    expect(ticketIdFromInboundAddress(ticket.replace('neon-t1+', 'neon-t2+'), ENV)).toBeNull()
  })

  it('signs the same id to a different tag under a different slug', () => {
    expect(signConversationId(REAL_ID, 'neon-t1', ENV)).not.toBe(
      signConversationId(REAL_ID, 'neon-t2', ENV)
    )
    expect(signTicketId(TICKET_ID, 'neon-t1', ENV)).not.toBe(
      signTicketId(TICKET_ID, 'neon-t2', ENV)
    )
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
        `neon-t1+c${REAL_ID}.${signConversationId(REAL_ID, SLUG, ENV)}@tenaevexeo.resend.app`,
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
    for (const slug of ['Neon-T1', 'neon_t1', 'neon t1', 'neon.t1', 'neon+t1', '']) {
      expect(isValidMailSlug(slug)).toBe(false)
      expect(() => inboundReplyToAddress(REAL_ID, slug, ENV)).toThrow(InvalidMailSlugError)
    }
    for (const slug of ['a', 'neon-t1', '0', 'a'.repeat(MAX_MAIL_SLUG_LENGTH)]) {
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
    expect(workspaceSlugFromInboundAddress('neon-t1@in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
  })

  it('folds case, as a receiving server may', () => {
    expect(workspaceSlugFromInboundAddress('Neon-T1+c01kw.sig@in.example')).toEqual({
      kind: 'slug',
      slug: SLUG,
    })
  })

  it('reports a label this grammar cannot mint as unreadable, never as absent', () => {
    for (const address of [
      'NOT_A_SLUG!!+c01kw8qxn1eeh4t2rek7varh032.sig@in.example',
      'a.very.long.customer.local.part@example.com',
      'not-an-address-at-all',
    ]) {
      expect(workspaceSlugFromInboundAddress(address)).toEqual({ kind: 'unreadable' })
    }
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
      bearsTicketMarker('neon-t1+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@in.example')
    ).toBe(true)
  })

  it('does not claim a conversation address or a bare support address', () => {
    expect(bearsTicketMarker(inboundReplyToAddress(REAL_ID, SLUG, ENV)!)).toBe(false)
    expect(bearsTicketMarker('neon-t1@in.example')).toBe(false)
  })

  // A customer plus-addressing for their own filing is the common case, and
  // several of those begin with the marker character. Claiming one drops the
  // whole message: a single such recipient anywhere in a reply-all thread is
  // enough, and per-site filing conventions produce them constantly.
  it('does not claim ordinary sub-addressing that merely starts with the marker', () => {
    for (const address of [
      'neon-t1+tuesday@in.example',
      'neon-t1+twitter.com@in.example',
      'me+twitter.com@gmail.com',
      'colleague+twitter.com@gmail.com',
      'neon-t1+t.a@in.example',
      // Right lengths, wrong places: a 22-char suffix and a 26-char tag.
      'neon-t1+tAAAAAAAAAAAAAAAAAAAAAA.01h455vb4pex5vsknk084sn02q@in.example',
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
