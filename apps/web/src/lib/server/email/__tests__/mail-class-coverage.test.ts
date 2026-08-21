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
 * This is the only hand-maintained list left. The `account` and `sealed` classes
 * used to be restated in an ESLint allow-list and a source-scanning test as
 * well, all three of which had to move together; the senders now declare
 * `to: SecureRecipient` themselves, so the compiler enforces that part and the
 * other two lists are gone. What a type cannot state is that a NEW template was
 * considered at all, which is what this checks.
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
  sendConversationClosedEmail: 'contact',
  sendConversationAutoAckEmail: 'contact',
  sendCsatRequestEmail: 'contact',
  sendStatusChangeEmail: 'contact',
  sendNewCommentEmail: 'contact',
  sendPostMentionEmail: 'contact',
  sendNoteMentionEmail: 'contact',
  sendChangelogPublishedEmail: 'contact',
  sendStatusIncidentPublishedEmail: 'contact',
  sendStatusMaintenanceScheduledEmail: 'contact',
  sendTicketEventEmail: 'contact',
  // Proves control of an address someone is claiming. The code confirms the
  // address; it grants nothing on its own, so it is not a capability.
  sendVerifyAddressEmail: 'contact',
  // Goes to an address a visitor typed, which is the definition of the contact
  // class. Safe there because it carries no link, no code and no account: it
  // says only that the workspace will not open one. That absence is what makes
  // the class honest, and `signup-not-allowed.test.tsx` is what pins it.
  sendSignupNotAllowedEmail: 'contact',

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

  it('every exported sender has a billable class', async () => {
    const { EMAIL_BILLABLE } = await import('@quackback/email')
    const exported = Object.keys(mail).filter((k) => /^send\w*Email$/.test(k))
    const missing = exported.filter((k) => {
      const emailType = k.slice(4)
      return !(emailType in EMAIL_BILLABLE)
    })
    expect(
      missing,
      `New mail sender(s) with no billable class. Add them to EMAIL_BILLABLE:\n${missing.join('\n')}`
    ).toEqual([])
  })
})
