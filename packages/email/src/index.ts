/**
 * Email sending module for Quackback
 *
 * Uses Nodemailer for SMTP or Resend API with React Email components.
 * No build step required - React components are rendered at runtime.
 *
 * Priority: SMTP (if EMAIL_SMTP_HOST set) → Resend (if EMAIL_RESEND_API_KEY set) → Console logging (dev mode)
 */

import { render } from '@react-email/components'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { Resend } from 'resend'
import { MagicLinkEmail } from './templates/magic-link'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'
import { PostMentionEmail } from './templates/post-mention'
import { ChangelogPublishedEmail } from './templates/changelog-published'
import { FeedbackLinkedEmail } from './templates/feedback-linked'
import { PasswordResetEmail } from './templates/password-reset'
import { RecoveryCodeUsedEmail } from './templates/recovery-code-used'
import { NewSignInEmail } from './templates/new-sign-in'
import { TicketEventEmail } from './templates/tickets/ticket-event'

/**
 * Get environment variable at runtime.
 * Reading process.env[key] in a function prevents Vite from inlining the value.
 */
function getEnv(key: string): string | undefined {
  return process.env[key]
}

function getEmailFrom(): string {
  const from = getEnv('EMAIL_FROM')
  if (!from) {
    throw new Error('EMAIL_FROM environment variable is required for sending emails')
  }
  return from
}

function getResendApiKey(): string | undefined {
  // Support both EMAIL_RESEND_API_KEY and RESEND_API_KEY
  return getEnv('EMAIL_RESEND_API_KEY') || getEnv('RESEND_API_KEY')
}

// Lazy-initialized transports
let smtpTransporter: Transporter | null = null
let resendClient: Resend | null = null

export type EmailResult = { sent: boolean }

type EmailProvider = 'smtp' | 'resend' | 'console'

export function isEmailConfigured(): boolean {
  return getProvider() !== 'console'
}

function getProvider(): EmailProvider {
  if (getEnv('EMAIL_SMTP_HOST')) return 'smtp'
  if (getResendApiKey()) return 'resend'
  return 'console'
}

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    const host = getEnv('EMAIL_SMTP_HOST')
    const port = parseInt(getEnv('EMAIL_SMTP_PORT') || '587', 10)
    const secure = getEnv('EMAIL_SMTP_SECURE') === 'true'
    console.log(`[Email] Initializing SMTP transporter: ${host}:${port} (secure=${secure})`)
    smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth:
        getEnv('EMAIL_SMTP_USER') || getEnv('EMAIL_SMTP_PASS')
          ? {
              user: getEnv('EMAIL_SMTP_USER') || '',
              pass: getEnv('EMAIL_SMTP_PASS') || '',
            }
          : undefined,
    })
  }
  return smtpTransporter
}

function getResend(): Resend {
  if (!resendClient) {
    console.log('[Email] Initializing Resend client')
    resendClient = new Resend(getResendApiKey())
  }
  return resendClient
}

/**
 * Send an email using the configured transport (SMTP or Resend).
 * Falls back to console logging if neither is configured.
 */
async function sendEmail(options: {
  to: string
  subject: string
  react: React.ReactElement
}): Promise<EmailResult> {
  const provider = getProvider()

  if (provider === 'smtp') {
    const html = await render(options.react)
    try {
      const result = await getSmtpTransporter().sendMail({
        from: getEmailFrom(),
        to: options.to,
        subject: options.subject,
        html,
      })
      console.log(`[Email] Sent via SMTP to ${options.to}, messageId: ${result.messageId}`)
    } catch (error) {
      // Reset transporter on connection errors so next attempt creates a fresh connection
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'ETIMEDOUT'
      ) {
        smtpTransporter = null
      }
      console.error(
        `[Email] SMTP send failed to ${options.to}:`,
        error instanceof Error ? error.message : error
      )
      throw error
    }
    return { sent: true }
  }

  if (provider === 'resend') {
    const result = await getResend().emails.send({
      from: getEmailFrom(),
      to: options.to,
      subject: options.subject,
      react: options.react,
    })
    if (result.error) {
      console.error(`[Email] Resend API error:`, JSON.stringify(result.error, null, 2))
      throw new Error(`Resend API error: ${result.error.message} (${result.error.name})`)
    }
    console.log(`[Email] Sent via Resend to ${options.to}, id: ${result.data?.id}`)
    return { sent: true }
  }

  // Console mode - caller handles logging
  return { sent: false }
}

// ============================================================================
// Invitation Email
// ============================================================================

interface SendInvitationParams {
  to: string
  invitedByName: string
  inviteeName?: string
  workspaceName: string
  inviteLink: string
  logoUrl?: string
}

export async function sendInvitationEmail(params: SendInvitationParams): Promise<EmailResult> {
  const { to, invitedByName, inviteeName, workspaceName, inviteLink, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Invitation Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Invitee name: ${inviteeName || '(not provided)'}`)
    console.log(`│ Invited by: ${invitedByName}`)
    console.log(`│ Workspace: ${workspaceName}`)
    console.log(`│ Invite link: ${inviteLink}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `You've been invited to join ${workspaceName} on Quackback`,
    react: InvitationEmail({
      invitedByName,
      inviteeName,
      organizationName: workspaceName,
      inviteLink,
      logoUrl,
    }),
  })
}

// ============================================================================
// Welcome Email
// ============================================================================

interface SendWelcomeParams {
  to: string
  name: string
  workspaceName: string
  dashboardUrl: string
  logoUrl?: string
}

export async function sendWelcomeEmail(params: SendWelcomeParams): Promise<EmailResult> {
  const { to, name, workspaceName, dashboardUrl, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Welcome Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Name: ${name}`)
    console.log(`│ Workspace: ${workspaceName}`)
    console.log(`│ Dashboard: ${dashboardUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `Welcome to ${workspaceName} on Quackback!`,
    react: WelcomeEmail({ name, workspaceName, dashboardUrl, logoUrl }),
  })
}

// ============================================================================
// Sign-in Email (magic link + 6-digit code combined)
// ============================================================================

interface SendMagicLinkParams {
  to: string
  signInUrl: string
  code: string
  logoUrl?: string
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<EmailResult> {
  const { to, signInUrl, code, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Sign-in Email (magic link + OTP)')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Link: ${signInUrl}`)
    console.log(`│ Code: ${code}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  console.log(`[Email] Sending sign-in email to ${to}`)
  return sendEmail({
    to,
    subject: 'Your Quackback sign-in link',
    react: MagicLinkEmail({ signInUrl, code, logoUrl }),
  })
}

// ============================================================================
// Password Reset Email
// ============================================================================

interface SendPasswordResetParams {
  to: string
  resetLink: string
  logoUrl?: string
}

export async function sendPasswordResetEmail(
  params: SendPasswordResetParams
): Promise<EmailResult> {
  const { to, resetLink, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Password Reset Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Reset link: ${resetLink}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  console.log(`[Email] Sending password reset to ${to}`)
  return sendEmail({
    to,
    subject: 'Reset your Quackback password',
    react: PasswordResetEmail({ resetLink, logoUrl }),
  })
}

// ============================================================================
// Recovery code used (security alert)
// ============================================================================

interface SendRecoveryCodeUsedParams {
  to: string
  workspaceName?: string
  ipAddress?: string | null
  userAgent?: string | null
  occurredAt: string
  logoUrl?: string
}

/**
 * Security alert sent after a recovery code is consumed. The recipient
 * is the user whose code was used — this is their canary against an
 * attacker who managed to obtain a code.
 */
export async function sendRecoveryCodeUsedEmail(
  params: SendRecoveryCodeUsedParams
): Promise<EmailResult> {
  const { to, workspaceName, ipAddress, userAgent, occurredAt, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Recovery Code Used (security alert)')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Workspace: ${workspaceName ?? '<unknown>'}`)
    console.log(`│ When: ${occurredAt}`)
    console.log(`│ IP: ${ipAddress ?? '<unknown>'}`)
    console.log(`│ User agent: ${userAgent ?? '<unknown>'}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  console.log(`[Email] Sending recovery-code-used alert to ${to}`)
  return sendEmail({
    to,
    subject: 'A recovery code on your account was just used',
    react: RecoveryCodeUsedEmail({ workspaceName, ipAddress, userAgent, occurredAt, logoUrl }),
  })
}

// ============================================================================
// New-device sign-in notification
// ============================================================================

interface SendNewSignInParams {
  to: string
  workspaceName?: string
  occurredAt: string
  ipAddress?: string | null
  userAgent?: string | null
  logoUrl?: string
}

/** First-sight new-device sign-in alert. Triggered by
 * `handleNewDeviceNotification` after a successful sign-in lands on
 * an unseen (UA, /24 IP) combination. */
export async function sendNewSignInEmail(params: SendNewSignInParams): Promise<EmailResult> {
  const { to, workspaceName, occurredAt, ipAddress, userAgent, logoUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] New-device sign-in alert')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Workspace: ${workspaceName ?? '<unknown>'}`)
    console.log(`│ When: ${occurredAt}`)
    console.log(`│ IP: ${ipAddress ?? '<unknown>'}`)
    console.log(`│ Device: ${userAgent ?? '<unknown>'}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  console.log(`[Email] Sending new-sign-in alert to ${to}`)
  return sendEmail({
    to,
    subject: 'New sign-in to your account',
    react: NewSignInEmail({ workspaceName, occurredAt, ipAddress, userAgent, logoUrl }),
  })
}

// ============================================================================
// Status Change Email
// ============================================================================

interface SendStatusChangeParams {
  to: string
  postTitle: string
  postUrl: string
  previousStatus: string
  newStatus: string
  workspaceName: string
  unsubscribeUrl: string
  logoUrl?: string
}

export async function sendStatusChangeEmail(params: SendStatusChangeParams): Promise<EmailResult> {
  const {
    to,
    postTitle,
    postUrl,
    previousStatus,
    newStatus,
    workspaceName,
    unsubscribeUrl,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Status Change Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Post: ${postTitle}`)
    console.log(`│ Status: ${previousStatus} → ${newStatus}`)
    console.log(`│ URL: ${postUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  const formattedNewStatus = newStatus.replace(/_/g, ' ')

  return sendEmail({
    to,
    subject: `Your feedback is now ${formattedNewStatus}!`,
    react: StatusChangeEmail({
      postTitle,
      postUrl,
      previousStatus,
      newStatus,
      organizationName: workspaceName,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// New Comment Email
// ============================================================================

interface SendNewCommentParams {
  to: string
  postTitle: string
  postUrl: string
  commenterName: string
  commentPreview: string
  isTeamMember: boolean
  workspaceName: string
  unsubscribeUrl: string
  logoUrl?: string
}

export async function sendNewCommentEmail(params: SendNewCommentParams): Promise<EmailResult> {
  const {
    to,
    postTitle,
    postUrl,
    commenterName,
    commentPreview,
    isTeamMember,
    workspaceName,
    unsubscribeUrl,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] New Comment Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Post: ${postTitle}`)
    console.log(`│ From: ${commenterName}${isTeamMember ? ' (Team)' : ''}`)
    console.log(`│ Comment: ${commentPreview.substring(0, 50)}...`)
    console.log(`│ URL: ${postUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `New comment on "${postTitle}"`,
    react: NewCommentEmail({
      postTitle,
      postUrl,
      commenterName,
      commentPreview,
      isTeamMember,
      organizationName: workspaceName,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// Post Mention Email
// ============================================================================

export interface SendPostMentionEmailArgs {
  to: string
  mentionerName: string
  postTitle: string
  /** Paragraph context for the mention. Empty string suppresses the quote block. */
  excerpt: string
  postUrl: string
  workspaceName: string
  unsubscribeUrl?: string
  logoUrl?: string
}

export async function sendPostMentionEmail(args: SendPostMentionEmailArgs): Promise<EmailResult> {
  const { to, mentionerName, postTitle, excerpt, postUrl, workspaceName, unsubscribeUrl, logoUrl } =
    args

  const displayName = mentionerName || 'Anonymous user'
  const subject = `${displayName} mentioned you in "${postTitle}"`

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Post Mention Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Mentioner: ${displayName}`)
    console.log(`│ Post: ${postTitle}`)
    console.log(`│ Excerpt: ${excerpt.substring(0, 80)}${excerpt.length > 80 ? '…' : ''}`)
    console.log(`│ URL: ${postUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl ?? '(none)'}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject,
    react: PostMentionEmail({
      mentionerName,
      postTitle,
      excerpt,
      postUrl,
      workspaceName,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// Changelog Published Email
// ============================================================================

interface SendChangelogPublishedParams {
  to: string
  changelogTitle: string
  changelogUrl: string
  contentPreview: string
  workspaceName: string
  unsubscribeUrl: string
  logoUrl?: string
}

export async function sendChangelogPublishedEmail(
  params: SendChangelogPublishedParams
): Promise<EmailResult> {
  const {
    to,
    changelogTitle,
    changelogUrl,
    contentPreview,
    workspaceName,
    unsubscribeUrl,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Changelog Published Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Changelog: ${changelogTitle}`)
    console.log(`│ Preview: ${contentPreview.substring(0, 50)}...`)
    console.log(`│ URL: ${changelogUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `New update: ${changelogTitle}`,
    react: ChangelogPublishedEmail({
      changelogTitle,
      changelogUrl,
      contentPreview,
      organizationName: workspaceName,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// Feedback Linked Email
// ============================================================================

interface SendFeedbackLinkedParams {
  to: string
  recipientName?: string
  postTitle: string
  postUrl: string
  workspaceName: string
  unsubscribeUrl: string
  attributedByName?: string
  logoUrl?: string
}

export async function sendFeedbackLinkedEmail(
  params: SendFeedbackLinkedParams
): Promise<EmailResult> {
  const {
    to,
    recipientName,
    postTitle,
    postUrl,
    workspaceName,
    unsubscribeUrl,
    attributedByName,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Feedback Linked Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Name: ${recipientName || '(not provided)'}`)
    console.log(`│ Post: ${postTitle}`)
    console.log(`│ Attributed by: ${attributedByName || '(not provided)'}`)
    console.log(`│ URL: ${postUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `Your feedback has been linked to "${postTitle}"`,
    react: FeedbackLinkedEmail({
      recipientName,
      postTitle,
      postUrl,
      workspaceName,
      unsubscribeUrl,
      attributedByName,
      logoUrl,
    }),
  })
}

// ============================================================================
// Re-export templates for preview/testing
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
export { MagicLinkEmail } from './templates/magic-link'
export { StatusChangeEmail } from './templates/status-change'
export { NewCommentEmail } from './templates/new-comment'
export { PostMentionEmail } from './templates/post-mention'
export { ChangelogPublishedEmail } from './templates/changelog-published'
export { FeedbackLinkedEmail } from './templates/feedback-linked'
export { PasswordResetEmail } from './templates/password-reset'
export { RecoveryCodeUsedEmail } from './templates/recovery-code-used'
export { NewSignInEmail } from './templates/new-sign-in'
export { TicketEventEmail } from './templates/tickets/ticket-event'

// ============================================================================
// Ticket Event Email (Phase 7.5)
// ============================================================================

interface SendTicketEventParams {
  to: string
  title: string
  body?: string
  ticketSubject: string
  ticketUrl: string
  workspaceName: string
  unsubscribeUrl: string
  logoUrl?: string
  statusLabel?: string
  priorityLabel?: string
}

/**
 * Send a ticket-event notification email.
 *
 * One function for all 8 ticket events + 2 SLA events. The caller decides
 * the title/body copy (per-event) and the receiver address.
 */
export async function sendTicketEventEmail(params: SendTicketEventParams): Promise<EmailResult> {
  const {
    to,
    title,
    body,
    ticketSubject,
    ticketUrl,
    workspaceName,
    unsubscribeUrl,
    logoUrl,
    statusLabel,
    priorityLabel,
  } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Ticket Event Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Title: ${title}`)
    if (body) console.log(`│ Body: ${body}`)
    console.log(`│ Ticket: ${ticketSubject}`)
    console.log(`│ URL: ${ticketUrl}`)
    console.log(`│ Unsubscribe: ${unsubscribeUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: title,
    react: TicketEventEmail({
      title,
      body,
      ticketSubject,
      ticketUrl,
      organizationName: workspaceName,
      unsubscribeUrl,
      logoUrl,
      statusLabel,
      priorityLabel,
    }),
  })
}
