/**
 * The address a workspace has before anybody configures anything.
 *
 * ## The defect this file exists for, and why every earlier proof missed it
 *
 * Cold inbound binds a new conversation to the front door it landed on, and the
 * only front door that existed was one a person had typed a forwarding address
 * into. So a workspace that had received NO configuration dropped every message
 * sent to its own address: accepted at SMTP, no bounce, nothing told to the
 * sender, nothing shown to the customer. It was invisible because every proof of
 * inbound ran against a workspace somebody had set up by hand — the fixture WAS
 * the configuration, so the tests could not see its absence.
 *
 * That is the reason for the assertion at the top of every case here: this suite
 * asserts it is starting from a workspace with NO channel accounts at all. A
 * fixture that quietly seeded one would rebuild the exact blindness that hid the
 * defect, and the assertion is what makes that a red test rather than a silent
 * one.
 *
 * The workspace scope is opened with a real per-workspace mail slug rather than
 * left to the self-hosted default, because the slug is what names a workspace on
 * a shared inbound domain and a constant one would make every "this is ours /
 * that is the neighbour's" case here vacuous.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { PrincipalId, TeamId } from '@quackback/ids'

// Read lazily through getters, so seeding before any config access is what makes
// config.baseUrl resolve for the insert-time trusted-url gate.
process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)
// The inbound channel's two halves. Both are read at call time, so the cases
// that need a different value below set one for their own duration.
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  channelAccounts,
  conversations,
  emailSendingDomains,
  principal,
  teams,
  eq,
  isNull,
  and,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Both emits dispatch to the bus (which needs runtime config); the writes under
// test are the conversation and the channel-account rows.
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
// The cold-inbound throttle is a real bucket keyed on the sender address, which
// this file hardcodes; left live it would burn a shared hourly budget and start
// failing as 'rate_limited' on repeated local runs. The arithmetic is pinned in
// conversation-ratelimit.test.ts.
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn().mockResolvedValue({ count: 1 }),
  incrementBuckets: vi.fn().mockResolvedValue([1]),
  bucketRetryAfter: vi.fn().mockResolvedValue(60),
}))

import { ingestParsedEmail } from '../conversation.email-inbound.service'
import { parseInboundEmail, parseRawEmail } from '../conversation.email-inbound'
import { isPlatformInboxRecipient, platformInboxAddress } from '../conversation.email-channel'
import { currentMailSlug } from '../conversation.mail-slug'
import {
  addressesPlatformInbox,
  resolveConversationFrom,
  setInboundForwardingTarget,
} from '@/lib/server/domains/channel-accounts/channel-account.service'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

/** The workspace this suite is, named as the live fleet names one. */
const WORKSPACE = 'live-t1'
const SLUG = mailSlugFor(WORKSPACE)
const PLATFORM_ADDRESS = `${SLUG}@tenaevexeo.resend.app`

/** Run `fn` as the workspace, which is what gives `currentMailSlug()` a slug. */
const asWorkspace = <T>(fn: () => T): T => withWorkspace(WORKSPACE, fn)

/** Run `fn` with some environment variables replaced, restored either way. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>
): Promise<void> {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]))
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  apply(vars)
  try {
    await fn()
  } finally {
    apply(before)
  }
}

/** Send under pooled tenancy, which is the only mode where the outbound sending
 *  guard has anything to decide: a single-workspace install has nobody to
 *  impersonate and permits any address, so an answer there proves nothing about
 *  the rule that actually grants one. */
const asPooled = (fn: () => Promise<void>) => withEnv({ QUACKBACK_TENANCY: 'pooled' }, fn)

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const coldEmail = (over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail => ({
  toAddresses: [PLATFORM_ADDRESS],
  ccAddresses: [],
  replyToAddresses: [],
  from: 'customer@acme.com',
  subject: 'Help with billing',
  text: 'My invoice looks wrong.',
  messageId: `<${suffix()}@acme.com>`,
  emailId: null,
  inReplyTo: null,
  references: [],
  autoSubmitted: null,
  autoResponseSuppress: null,
  precedence: null,
  hasListHeaders: false,
  authenticationResults: 'mx; spf=pass; dmarc=pass (p=reject) header.from=acme.com',
  ...over,
})

const liveChannelAccounts = () =>
  testDb.select().from(channelAccounts).where(isNull(channelAccounts.deletedAt))

/**
 * The precondition every case here depends on: this workspace has no email
 * configuration whatsoever.
 *
 * Asserted rather than assumed, because a fixture that arrives pre-configured is
 * precisely what hid the defect. It also pins the other half — the default team
 * the SQL bundle seeds — since a route has to be owned by one.
 */
async function assertUnconfiguredWorkspace(): Promise<TeamId> {
  expect(await liveChannelAccounts()).toEqual([])
  const [team] = await testDb
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)))
    .limit(1)
  expect(team?.id, 'a workspace is seeded with one default team').toBeTruthy()
  return team.id
}

describe.skipIf(!fixture.available)('the platform inbox (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('receives mail at the workspace address with nothing configured', async () => {
    const owningTeamId = await assertUnconfiguredWorkspace()

    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))

    // The live symptom was `no_conversation` here, and the whole cost of it was
    // that nothing downstream existed to notice.
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.channel).toBe('email')
    expect(conv.subject).toBe('Help with billing')
    // Waiting on a first reply from the moment it lands, like any other thread.
    expect(conv.waitingSince).not.toBeNull()

    // The route the message was bound to is the one this workspace just gained.
    const accounts = await liveChannelAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      owningTeamId,
      role: 'inbound',
      channel: 'email',
      // NOTHING is written into `address`, and that is the design. Both
      // directions derive the platform address instead — inbound from the
      // recipient's own label, outbound from the workspace's slug — so it
      // cannot go stale under a domain change, cannot put this row under the
      // sending-address unique index, and cannot outrank a customer's own
      // verified address in the From chain.
      address: null,
    })
    // `forwardingTarget` means the address a CUSTOMER forwards mail from, and
    // leaving it free is what lets forwarding be added later without displacing
    // the address the workspace already answers on.
    expect(accounts[0].config.forwardingTarget).toBeUndefined()
    expect(conv.channelAccountId).toBe(accounts[0].id)
  })

  it('sends from the workspace address it received on', async () => {
    await assertUnconfiguredWorkspace()
    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    // The reply leaves as the address the customer wrote to. Asked under POOLED
    // tenancy, which is the only mode where the sending guard has anything to
    // decide: a single-workspace install has nobody to impersonate and permits
    // any address, so a pass there would prove nothing about the rule that
    // actually grants this one (the label on the minting domain).
    await asPooled(async () => {
      const from = await asWorkspace(() => resolveConversationFrom(res.conversationId))
      expect(from).toBe(PLATFORM_ADDRESS)
    })
  })

  it('changes nothing on the second message', async () => {
    await assertUnconfiguredWorkspace()

    const first = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    const accountsAfterFirst = await liveChannelAccounts()
    const second = await asWorkspace(() =>
      ingestParsedEmail(coldEmail({ from: 'someone-else@acme.com', subject: 'A second thread' }))
    )

    expect(first.status).toBe('ingested')
    expect(second.status).toBe('ingested')
    if (first.status !== 'ingested' || second.status !== 'ingested') return

    // One front door, byte for byte the same row: a second delivery must not
    // insert, update, or resurrect anything.
    const accounts = await liveChannelAccounts()
    expect(accounts).toEqual(accountsAfterFirst)
    expect(accounts).toHaveLength(1)

    const bound = await testDb
      .select({ channelAccountId: conversations.channelAccountId })
      .from(conversations)
      .where(eq(conversations.channelAccountId, accounts[0].id))
    expect(bound).toHaveLength(2)
  })

  it('leaves a workspace that already has an inbound route completely alone', async () => {
    // The shape of a workspace somebody configured by hand: a route pointed at
    // the inbox they forward from, which names neither the platform address nor
    // the platform's domain. Its mail must keep arriving exactly as it did.
    const owningTeamId = await assertUnconfiguredWorkspace()
    const [existing] = await testDb
      .insert(channelAccounts)
      .values({
        owningTeamId,
        role: 'inbound',
        config: { forwardingTarget: 'support@acme.com', provider: 'resend' },
      })
      .returning()

    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    // No second row (the partial unique index allows only one anyway, so the
    // alternative to reusing it is a failed insert and a dropped message), and
    // not one column of the existing one rewritten.
    const accounts = await liveChannelAccounts()
    expect(accounts).toEqual([existing])

    const [conv] = await testDb
      .select({ channelAccountId: conversations.channelAccountId })
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.channelAccountId).toBe(existing.id)
  })

  it('receives a message that only CCs the workspace address', async () => {
    // The recipient set is To ∪ Cc, because a customer looping support into a
    // thread with somebody else puts the address in Cc, and reading To alone
    // would drop exactly that message.
    await assertUnconfiguredWorkspace()

    const res = await asWorkspace(() =>
      ingestParsedEmail(
        coldEmail({ toAddresses: ['colleague@acme.com'], ccAddresses: [PLATFORM_ADDRESS] })
      )
    )
    expect(res.status).toBe('ingested')
    expect(await liveChannelAccounts()).toHaveLength(1)
  })

  it('is not a route for mail addressed to anyone else', async () => {
    await assertUnconfiguredWorkspace()

    for (const to of [
      // A stranger's address on a domain we have nothing to do with.
      'nobody@elsewhere.com',
      // The NEIGHBOUR's platform address. The signing secret and the inbound
      // domain are both fleet-wide, so the label is the whole of what separates
      // two workspaces; reading this as ours writes a stranger's mail into this
      // database.
      'ws-t2@tenaevexeo.resend.app',
      // Our label at somebody else's domain.
      `${SLUG}@evil.test`,
    ]) {
      const res = await asWorkspace(() => ingestParsedEmail(coldEmail({ toAddresses: [to] })))
      expect(res.status, to).toBe('no_conversation')
    }
    // And nothing was written for any of them.
    expect(await liveChannelAccounts()).toEqual([])
  })

  it('gives a workspace with no mail slug no address rather than an unroutable one', async () => {
    await assertUnconfiguredWorkspace()

    // Pooled with no workspace resolved is the one state that has no slug. On a
    // shared front door an unslugged local part names no workspace, so there is
    // nothing to mint rather than something to fall back to.
    await asPooled(async () => {
      expect(currentMailSlug()).toBe(null)
      expect(platformInboxAddress(currentMailSlug())).toBe(null)

      for (const to of [PLATFORM_ADDRESS, '@tenaevexeo.resend.app', 'tenaevexeo.resend.app']) {
        const res = await ingestParsedEmail(coldEmail({ toAddresses: [to] }))
        expect(res.status, to).toBe('no_conversation')
      }
    })

    expect(await liveChannelAccounts()).toEqual([])
  })

  it('mints nothing when the inbound domain names no domain', async () => {
    await assertUnconfiguredWorkspace()

    // The typo a mail cutover invites. `inboundMintDomain` refuses it outright,
    // which disables inbound rather than corrupting it; a default route must not
    // paper over that refusal by inventing an address on a domain no mail server
    // will ever deliver to.
    await withEnv({ EMAIL_INBOUND_DOMAIN: 'a.example,b.example' }, async () => {
      expect(asWorkspace(() => platformInboxAddress(currentMailSlug()))).toBe(null)

      for (const to of [
        `${SLUG}@a.example`,
        `${SLUG}@b.example`,
        `${SLUG}@a.example,b.example`,
        PLATFORM_ADDRESS,
      ]) {
        const res = await asWorkspace(() => ingestParsedEmail(coldEmail({ toAddresses: [to] })))
        expect(res.status, to).toBe('no_conversation')
      }
    })

    expect(await liveChannelAccounts()).toEqual([])
  })

  /**
   * A recipient the door still accepts, at a moment when there is no address to
   * mint. The one configuration in which the two halves disagree, and therefore
   * the only one in which the mint-domain precondition decides anything.
   *
   * The case above it makes the mint domain unusable and nothing else, which
   * empties the accept-set as a side effect — so the recipient is refused for
   * being addressed to no domain we answer for, and the precondition is never
   * reached. Add an extra domain and the accept-set is populated again by a
   * value that mints nothing: the message IS ours, and we still have no address
   * to bind it to. Recognising it and then inventing a front door on a domain no
   * mail server delivers to would give the workspace a permanent row and a reply
   * address that goes nowhere.
   */
  it('refuses mail it can recognise but has no address to answer as', async () => {
    await assertUnconfiguredWorkspace()

    await withEnv(
      {
        EMAIL_INBOUND_DOMAIN: 'a.example,b.example',
        EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example',
      },
      async () => {
        const to = `${SLUG}@old.example`
        // The fixture reaches the precondition rather than being turned back
        // before it: the accept-set is non-empty and this recipient is in it...
        expect(asWorkspace(() => isPlatformInboxRecipient(to, currentMailSlug()))).toBe(true)
        // ...while the value that names the minting domain names no domain, so
        // there is no address for this workspace at all.
        expect(asWorkspace(() => platformInboxAddress(currentMailSlug()))).toBe(null)
        // Which leaves exactly one thing for the precondition to decide.
        expect(asWorkspace(() => addressesPlatformInbox([to]))).toBe(false)

        const res = await asWorkspace(() => ingestParsedEmail(coldEmail({ toAddresses: [to] })))
        expect(res.status).toBe('no_conversation')
      }
    )

    expect(await liveChannelAccounts()).toEqual([])
    expect(await testDb.select({ id: conversations.id }).from(conversations)).toEqual([])
  })

  it('answers on a retired domain but only ever mints on the current one', async () => {
    await assertUnconfiguredWorkspace()

    // A domain change: minting moves in one step, accepting cannot move at all,
    // because every address ever published is still in somebody's mail client.
    await withEnv({ EMAIL_INBOUND_EXTRA_DOMAINS: 'old.example' }, async () => {
      const res = await asWorkspace(() =>
        ingestParsedEmail(coldEmail({ toAddresses: [`${SLUG}@old.example`] }))
      )
      expect(res.status).toBe('ingested')
    })

    // Recognised on the retired domain, answered from the minting one — an
    // extra has no verified sending identity behind it, so a From built there
    // is one the provider refuses. The route itself names no address, so the
    // asymmetry lives where it is decided rather than in a stored value.
    const accounts = await liveChannelAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].address).toBeNull()

    const [conv] = await testDb.select({ id: conversations.id }).from(conversations)
    await asPooled(async () => {
      expect(await asWorkspace(() => resolveConversationFrom(conv.id))).toBe(PLATFORM_ADDRESS)
    })
  })

  it('does not treat a sending address as a front door', async () => {
    // A `sending` row is a From identity. Mail to one is not cold inbound, and
    // that refusal must survive the platform inbox being added beside it.
    const owningTeamId = await assertUnconfiguredWorkspace()
    await testDb.insert(channelAccounts).values({
      owningTeamId,
      role: 'sending',
      module: 'support',
      address: 'billing@acme.com',
    })

    const res = await asWorkspace(() =>
      ingestParsedEmail(coldEmail({ toAddresses: ['billing@acme.com'] }))
    )
    expect(res.status).toBe('no_conversation')
    expect(await liveChannelAccounts()).toHaveLength(1)
  })

  it('still receives when the workspace address is ALSO registered as a sending identity', async () => {
    // The neighbouring case of the one above, and the one that had teeth: the
    // outbound guard grants a workspace its own label on the minting domain, so
    // the settings page invites exactly this row. A front door that could not be
    // created beside it would take inbound mail down permanently, and silently,
    // for a workspace that did nothing but use the feature as advertised.
    const owningTeamId = await assertUnconfiguredWorkspace()
    const [sending] = await testDb
      .insert(channelAccounts)
      .values({ owningTeamId, role: 'sending', module: 'support', address: PLATFORM_ADDRESS })
      .returning()

    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const accounts = await liveChannelAccounts()
    expect(accounts).toHaveLength(2)
    const inbound = accounts.find((a) => a.role === 'inbound')
    expect(inbound).toBeDefined()
    const [conv] = await testDb
      .select({ channelAccountId: conversations.channelAccountId })
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    // Bound to the front door, never to the From identity that shares its name.
    expect(conv.channelAccountId).toBe(inbound?.id)
    expect(conv.channelAccountId).not.toBe(sending.id)
  })

  it('replies as the customer own verified address once forwarding is configured', async () => {
    // The whole point of a customer-owned sending domain: a thread that arrived
    // at `support@acme.com` must not change identity on the way back. The
    // platform address is the fallback for a workspace that has nothing, and a
    // fallback that outranks configuration is not a fallback.
    const owningTeamId = await assertUnconfiguredWorkspace()

    // The order that actually happens: the default materialises on the first
    // message, and the customer configures forwarding afterwards.
    const first = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(first.status).toBe('ingested')
    await setInboundForwardingTarget({ owningTeamId, forwardingTarget: 'support@acme.com' })
    await testDb.insert(emailSendingDomains).values({
      owningTeamId,
      domain: 'acme.com',
      status: 'verified',
      verifiedAt: new Date(),
    })

    const res = await asWorkspace(() =>
      ingestParsedEmail(coldEmail({ toAddresses: ['support@acme.com'], from: 'buyer@example.com' }))
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return
    expect(await liveChannelAccounts()).toHaveLength(1)

    await asPooled(async () => {
      expect(await asWorkspace(() => resolveConversationFrom(res.conversationId))).toBe(
        'support@acme.com'
      )
    })
  })

  it('answers on the address of the day after a mint-domain cutover', async () => {
    // An install's inbound domain moves, and every workspace's own address moves
    // with it. A From remembered from before the move is on a domain with no
    // sending identity behind it any more, so it is refused and the reply leaves
    // as the platform default with a warning per message. Derived, it just moves.
    await assertUnconfiguredWorkspace()
    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    await withEnv(
      {
        QUACKBACK_TENANCY: 'pooled',
        EMAIL_INBOUND_DOMAIN: 'newmail.example',
        // Still received on, because every address published before the move is
        // in somebody's mail client.
        EMAIL_INBOUND_EXTRA_DOMAINS: 'tenaevexeo.resend.app',
      },
      async () => {
        expect(await asWorkspace(() => resolveConversationFrom(res.conversationId))).toBe(
          `${SLUG}@newmail.example`
        )
      }
    )
  })

  /**
   * The carve-out at the end of the From chain: the platform address is the last
   * resort for a thread that came through an email front door, and no resort at
   * all for a thread that did not.
   *
   * A messenger thread has no channel account, and its notifications have always
   * gone out from the branded workspace default. Letting it fall through to the
   * platform inbox would rebrand every one of them as `<slug>@<mint domain>` —
   * an address the customer never wrote to, on the platform's own shared domain,
   * for a workspace that may have configured nothing at all.
   *
   * Both threads are resolved in one run and the email one is asserted first,
   * because the null below only means something if the platform address WAS
   * available and permitted at that moment. Otherwise the case would pass just as
   * happily against a workspace that had no address to offer either thread.
   */
  it('keeps the branded default for a thread that did not arrive by email', async () => {
    await assertUnconfiguredWorkspace()

    const arrived = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(arrived.status).toBe('ingested')
    if (arrived.status !== 'ingested') return

    const [visitor] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', displayName: 'A visitor', createdAt: new Date() })
      .returning({ id: principal.id })
    const [widget] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: visitor.id, channel: 'messenger', source: 'widget' })
      .returning({ id: conversations.id, channelAccountId: conversations.channelAccountId })
    expect(widget.channelAccountId).toBeNull()

    await asPooled(async () => {
      // The address exists, is derivable, and is one this workspace is permitted
      // to send as: the email thread beside it leaves as exactly that.
      expect(await asWorkspace(() => resolveConversationFrom(arrived.conversationId))).toBe(
        PLATFORM_ADDRESS
      )
      // The messenger thread still resolves to nothing, which is what the
      // notification path reads as the workspace's own branded sender.
      expect(await asWorkspace(() => resolveConversationFrom(widget.id))).toBeNull()
    })
  })

  it('drops a ticket-marked address that arrives in Cc instead of opening it as new mail', async () => {
    // A ticket address whose tag does not verify is ticket-destined and DROPPED,
    // never reinterpreted. The guards that decide that read `To`, while cold
    // inbound reads To ∪ Cc, so a forged ticket address parked in Cc walked
    // straight past them and opened a thread from a stranger.
    await assertUnconfiguredWorkspace()
    const forged = `${SLUG}+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@tenaevexeo.resend.app`

    const res = await asWorkspace(() =>
      ingestParsedEmail(
        coldEmail({ toAddresses: ['someone-else@acme.com'], ccAddresses: [forged] })
      )
    )

    expect(res.status).toBe('no_ticket')
    expect(await liveChannelAccounts()).toEqual([])
    expect(await testDb.select({ id: conversations.id }).from(conversations)).toEqual([])
  })

  it('recognises the workspace address in the form each front door hands it over in', async () => {
    // `headerAddresses` (raw MIME, so IMAP) and `addressArray` (a provider
    // webhook payload) both pass an address-list entry through untouched, so a
    // `To` written the ordinary way still wears its display name here. The
    // signed-envelope door hides this by prepending the bare envelope address;
    // IMAP is a self-hosted install's whole inbound channel and has no such door.
    await assertUnconfiguredWorkspace()

    const imap = parseRawEmail(
      [
        'From: "A Customer" <customer@acme.com>',
        `To: "Acme Support" <${PLATFORM_ADDRESS}>`,
        'Subject: Help with billing',
        `Message-ID: <${suffix()}@acme.com>`,
        'Authentication-Results: mx; spf=pass; dmarc=pass (p=reject) header.from=acme.com',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'My invoice looks wrong.',
      ].join('\r\n')
    )
    expect(imap.toAddresses).toEqual([`"Acme Support" <${PLATFORM_ADDRESS}>`])
    expect((await asWorkspace(() => ingestParsedEmail(imap))).status).toBe('ingested')

    const webhook = parseInboundEmail({
      to: [`Acme Support <${PLATFORM_ADDRESS}>`],
      from: 'A Customer <customer@acme.com>',
      subject: 'A second thread',
      text: 'And another question.',
      headers: [{ name: 'Message-ID', value: `<${suffix()}@acme.com>` }],
    })
    expect((await asWorkspace(() => ingestParsedEmail(webhook))).status).toBe('ingested')

    // One front door for both, and no second row.
    expect(await liveChannelAccounts()).toHaveLength(1)
  })

  it('creates no front door for a message the drop gates refuse', async () => {
    // The write is the workspace gaining a permanent row, so it belongs after
    // everything that can refuse the message and not before it. Ahead of them,
    // a stranger whose mail is thrown away still leaves this behind.
    await assertUnconfiguredWorkspace()

    const empty = await asWorkspace(() =>
      ingestParsedEmail(coldEmail({ text: '', html: undefined }))
    )
    expect(empty.status).toBe('empty')
    expect(await liveChannelAccounts()).toEqual([])

    const noSender = await asWorkspace(() =>
      ingestParsedEmail(coldEmail({ from: 'not an address' }))
    )
    expect(noSender.status).toBe('from_mismatch')
    expect(await liveChannelAccounts()).toEqual([])
  })

  it('opens the thread from the sender, not from the address it arrived at', async () => {
    // Guards the one write that IS influenced by the message: the lead. The
    // route's address comes from configuration, the visitor's from the envelope,
    // and swapping them would file every customer under the support address.
    await assertUnconfiguredWorkspace()
    const res = await asWorkspace(() => ingestParsedEmail(coldEmail()))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const [conv] = await testDb
      .select({
        visitorEmail: conversations.visitorEmail,
        visitor: conversations.visitorPrincipalId,
      })
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.visitorEmail).toBe('customer@acme.com')
    expect(conv.visitor as PrincipalId).toBeTruthy()
  })
})
