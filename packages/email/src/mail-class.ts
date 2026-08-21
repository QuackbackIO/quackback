/**
 * Billable vs exempt email classes for the workspace meter.
 *
 * Conversation, ticket, changelog, status-page, and CSAT mail are billable.
 * Auth-critical transactional mail is exempt and can never be starved by a quota.
 * Unclassified senders fail the mail-class-coverage trip-wire.
 */
export const EMAIL_BILLABLE: Record<string, boolean> = {
  ConversationMessageEmail: true,
  ConversationReplyEmail: true,
  ConversationClosedEmail: true,
  ConversationAutoAckEmail: true,
  CsatRequestEmail: true,
  TicketEventEmail: true,
  ChangelogPublishedEmail: true,
  StatusChangeEmail: true,
  StatusIncidentPublishedEmail: true,
  StatusMaintenanceScheduledEmail: true,
  NewCommentEmail: true,
  PostMentionEmail: true,
  NoteMentionEmail: true,
  FeedbackLinkedEmail: true,
  WelcomeEmail: true,

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
