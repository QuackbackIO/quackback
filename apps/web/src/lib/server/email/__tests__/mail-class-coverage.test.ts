import { describe, it, expect } from 'vitest'
import * as mail from '@quackback/email'

/**
 * Every mail template must be classified before it can ship.
 *
 * A new `send*Email` export is the moment someone decides where its recipient
 * comes from, and it is the moment that decision is easiest to make by accident
 * — copy an adjacent caller, inherit its recipient, done. This fails CI until
 * the class is stated, which is cheap now and expensive to reconstruct later.
 *
 * `account` and `sealed` additionally appear in the allow-lists of
 * `lib/server/__tests__/security-mail-recipients.test.ts` and `eslint.config.js`.
 * The three lists must move together.
 */
const MAIL_CLASS: Record<string, 'account' | 'sealed' | 'contact' | 'unused'> = {
  // Capability over an existing account: recipient is user.email by id.
  sendPasswordResetEmail: 'account',
  sendNewSignInEmail: 'account',
  sendRecoveryCodeUsedEmail: 'account',

  // Capability over whoever holds the address: mail exactly what was minted.
  sendMagicLinkEmail: 'sealed',
  sendInvitationEmail: 'sealed',
  sendPortalInviteEmail: 'sealed',

  // No capability: may follow the contact address.
  sendConversationMessageEmail: 'contact',
  sendCsatRequestEmail: 'contact',
  sendStatusChangeEmail: 'contact',
  sendNewCommentEmail: 'contact',
  sendPostMentionEmail: 'contact',
  sendChangelogPublishedEmail: 'contact',
  sendStatusIncidentPublishedEmail: 'contact',
  sendStatusMaintenanceScheduledEmail: 'contact',
  sendTicketEventEmail: 'contact',
  sendConfirmContactEmail: 'contact',

  // Exported with no production caller. Classified rather than deleted so the
  // decision to remove them is a separate, deliberate change.
  sendWelcomeEmail: 'unused',
  sendFeedbackLinkedEmail: 'unused',
  sendRawEmail: 'unused',
}

describe('mail class coverage', () => {
  it('every exported sender has a class', () => {
    const exported = Object.keys(mail).filter((k) => /^send\w*Email$/.test(k))
    const unclassified = exported.filter((k) => !(k in MAIL_CLASS))
    expect(
      unclassified,
      `New mail template(s) with no recipient class. Decide where the recipient ` +
        `comes from and add it to MAIL_CLASS:\n${unclassified.join('\n')}`
    ).toEqual([])
  })

  it('every class entry still corresponds to a real export', () => {
    // Catches the other drift direction: a template removed but left classified,
    // which would quietly shrink the guard's coverage.
    const exported = new Set(Object.keys(mail))
    const stale = Object.keys(MAIL_CLASS).filter((k) => !exported.has(k))
    expect(stale, `Classified but no longer exported:\n${stale.join('\n')}`).toEqual([])
  })
})
