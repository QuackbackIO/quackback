/**
 * Which linked issues hear a ticket's reply events: every active link of a
 * provider that mirrors replies as comments, never a link without a
 * connection, and never back to the integration whose own principal wrote
 * the reply (other integrations still hear it). Whether the link's
 * repository takes it is queueing's to decide (see ticket-comments.db.test).
 */
import { describe, it, expect } from 'vitest'
import {
  buildTicketCommentTargets,
  ticketCommentResolver,
  type CommentLinkRow,
} from '../ticket-comment.resolver'

const GITHUB_PRINCIPAL = 'prn_github_service'

const link = (over: Partial<CommentLinkRow> = {}): CommentLinkRow => ({
  linkId: 'lnk_api',
  integrationId: 'int_github',
  integrationType: 'github',
  integrationPrincipalId: GITHUB_PRINCIPAL,
  ...over,
})

const mirrors = (type: string) => type === 'github'

describe('buildTicketCommentTargets', () => {
  it('routes a teammate reply to every linked issue of a mirroring provider', () => {
    const targets = buildTicketCommentTargets({
      links: [
        link(),
        link({ linkId: 'lnk_web' }),
        link({ linkId: 'lnk_linear', integrationType: 'linear', integrationId: 'int_linear' }),
        link({ linkId: 'lnk_orphan', integrationId: null }),
      ],
      actorType: 'user',
      actorId: 'prn_alice',
      mirrorsReplies: mirrors,
    })
    expect(targets).toEqual([
      {
        type: 'ticket_comment',
        target: { linkId: 'lnk_api' },
        config: { integrationId: 'int_github' },
        deliveryKey: 'comment:lnk_api',
      },
      {
        type: 'ticket_comment',
        target: { linkId: 'lnk_web' },
        config: { integrationId: 'int_github' },
        deliveryKey: 'comment:lnk_web',
      },
    ])
  })

  it('never sends a reply back to the integration that wrote it', () => {
    const fromGitHub = {
      links: [link(), link({ linkId: 'lnk_other', integrationPrincipalId: 'prn_other' })],
      actorType: 'service',
      actorId: GITHUB_PRINCIPAL,
      mirrorsReplies: mirrors,
    }
    expect(buildTicketCommentTargets(fromGitHub).map((t) => t.target)).toEqual([
      { linkId: 'lnk_other' },
    ])
  })
})

describe('ticketCommentResolver', () => {
  it('listens to the reply events and nothing else', () => {
    for (const type of [
      'ticket.replied',
      'ticket.reply_updated',
      'ticket.reply_deleted',
      'ticket.attachment_added',
      'ticket.attachment_removed',
    ])
      expect(ticketCommentResolver.interestedIn(type)).toBe(true)
    for (const type of ['ticket.note_added', 'ticket.created', 'message.created'])
      expect(ticketCommentResolver.interestedIn(type)).toBe(false)
  })
})
