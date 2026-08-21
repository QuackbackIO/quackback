/**
 * Where a sender gets the slug it mints an address under.
 *
 * The grammar's own suite proves what a slugged address is. This one proves the
 * seam either side of it: that a pooled sender spends the slug the registry
 * record carries, and that the two deployments with no registry at all still
 * mint something — or deliberately nothing — rather than falling over.
 *
 * The assertions run the real minters rather than inspecting the slug alone,
 * because "the accessor returned a string" is not the property. The property is
 * that the string reaches a customer's mail client as an address that verifies
 * back to the same conversation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import {
  conversationIdFromInboundAddress,
  inboundReplyToAddress,
  inboundTicketReplyToAddress,
  isValidMailSlug,
  ticketIdFromInboundAddress,
  workspaceSlugFromInboundAddress,
} from '../conversation.email-channel'
import { SELF_HOSTED_MAIL_SLUG, currentMailSlug } from '../conversation.mail-slug'

const ENV = {
  EMAIL_INBOUND_DOMAIN: 'quackback.co.uk',
  EMAIL_INBOUND_SIGNING_SECRET: 'whsec_dGVzdHNlY3JldA==',
}

const CONVERSATION_ID = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId
const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q' as TicketId

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('currentMailSlug', () => {
  it('is the registry record’s slug inside a workspace scope', () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    expect(withWorkspace('ws-t1', () => currentMailSlug())).toBe(mailSlugFor('ws-t1'))
    expect(withWorkspace('ws-t2', () => currentMailSlug())).toBe(mailSlugFor('ws-t2'))
  })

  it('is the self-hosted label with no scope on a single-workspace process', () => {
    expect(currentMailSlug()).toBe(SELF_HOSTED_MAIL_SLUG)
  })

  it('is null with no scope on a pooled process', () => {
    // Not the self-hosted label: on a shared inbound domain that address names
    // no workspace, so it would leave carrying a route home that cannot resolve.
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    expect(currentMailSlug()).toBeNull()
  })

  it('mints a label the grammar accepts, so the self-hosted path is not a special case', () => {
    expect(isValidMailSlug(SELF_HOSTED_MAIL_SLUG)).toBe(true)
  })
})

describe('minting from a workspace scope', () => {
  it('carries the scope’s slug into a conversation address that verifies back', () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    const address = withWorkspace('ws-t1', () =>
      inboundReplyToAddress(CONVERSATION_ID, currentMailSlug(), ENV)
    )
    expect(address).not.toBeNull()
    expect(workspaceSlugFromInboundAddress(address!)).toEqual({
      kind: 'slug',
      slug: mailSlugFor('ws-t1'),
    })
    expect(conversationIdFromInboundAddress(address!, ENV)).toBe(CONVERSATION_ID)
  })

  it('carries it into a ticket address too', () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    const address = withWorkspace('ws-t1', () =>
      inboundTicketReplyToAddress(TICKET_ID, currentMailSlug(), ENV)
    )
    expect(address).not.toBeNull()
    expect(ticketIdFromInboundAddress(address!, ENV)).toBe(TICKET_ID)
  })

  it('mints a different address per workspace for the same conversation id', () => {
    // The isolation the slug exists for: the tag covers the pair, so one
    // workspace's reply address cannot be re-slugged into another's.
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    const one = withWorkspace('ws-t1', () =>
      inboundReplyToAddress(CONVERSATION_ID, currentMailSlug(), ENV)
    )
    const two = withWorkspace('ws-t2', () =>
      inboundReplyToAddress(CONVERSATION_ID, currentMailSlug(), ENV)
    )
    expect(one).not.toBe(two)

    const reslugged = one!.replace(mailSlugFor('ws-t1'), mailSlugFor('ws-t2'))
    expect(conversationIdFromInboundAddress(reslugged, ENV)).toBeNull()
  })
})

describe('minting with no workspace scope', () => {
  it('a single-workspace install still gets a routable address on the self-hosted label', () => {
    // `reply` is the label the grammar hard-coded before a fleet existed, so an
    // install that changed nothing keeps receiving on the address it already
    // routes. A regression here is reply-by-email silently ending for every
    // self-hoster on upgrade.
    const address = inboundReplyToAddress(CONVERSATION_ID, currentMailSlug(), ENV)
    expect(address).toMatch(
      /^reply\+c01kw8qxn1eeh4t2rek7varh032\.[A-Za-z0-9_-]{22}@quackback\.co\.uk$/
    )
    expect(conversationIdFromInboundAddress(address!, ENV)).toBe(CONVERSATION_ID)
    expect(
      ticketIdFromInboundAddress(
        inboundTicketReplyToAddress(TICKET_ID, currentMailSlug(), ENV)!,
        ENV
      )
    ).toBe(TICKET_ID)
  })

  it('a pooled process mints nothing rather than an unroutable address', () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    expect(inboundReplyToAddress(CONVERSATION_ID, currentMailSlug(), ENV)).toBeNull()
    expect(inboundTicketReplyToAddress(TICKET_ID, currentMailSlug(), ENV)).toBeNull()
  })
})
