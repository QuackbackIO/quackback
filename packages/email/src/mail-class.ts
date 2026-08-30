/**
 * Billable vs exempt email classes for the workspace meter.
 *
 * The monthly cap covers broadcast mail: changelog and status-page
 * subscriber sends. Inbox, ticket, feedback status, comments, mentions,
 * and auth mail do not draw from it. Unclassified senders fail the
 * mail-class-coverage trip-wire.
 */
export const EMAIL_BILLABLE: Record<string, boolean> = {
  ChangelogPublishedEmail: true,
  StatusIncidentPublishedEmail: true,
  StatusMaintenanceScheduledEmail: true,

  ConversationMessageEmail: false,
  ConversationReplyEmail: false,
  ConversationClosedEmail: false,
  ConversationAutoAckEmail: false,
  CsatRequestEmail: false,
  TicketEventEmail: false,
  StatusChangeEmail: false,
  NewCommentEmail: false,
  PostMentionEmail: false,
  NoteMentionEmail: false,
  FeedbackLinkedEmail: false,
  WelcomeEmail: false,

  MagicLinkEmail: false,
  PasswordResetEmail: false,
  RecoveryCodeUsedEmail: false,
  NewSignInEmail: false,
  InvitationEmail: false,
  PortalInviteEmail: false,
  VerifyAddressEmail: false,
  SignupNotAllowedEmail: false,
  RawEmail: false,
}

export function isEmailBillable(emailType: string | undefined): boolean {
  if (!emailType) return false
  return EMAIL_BILLABLE[emailType] === true
}
