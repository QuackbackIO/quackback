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
import { createLogger } from '@quackback/logger'
import { isSyntheticAnonEmail } from './anon'
import { MagicLinkEmail } from './templates/magic-link'
import { InvitationEmail } from './templates/invitation'
import { PortalInviteEmail } from './templates/portal-invite'
import { WelcomeEmail } from './templates/welcome'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'
import { ConversationMessageEmail } from './templates/conversation-message'
import { PostMentionEmail } from './templates/post-mention'
import { ChangelogPublishedEmail } from './templates/changelog-published'
import { FeedbackLinkedEmail } from './templates/feedback-linked'
import { PasswordResetEmail } from './templates/password-reset'
import { RecoveryCodeUsedEmail } from './templates/recovery-code-used'
import { NewSignInEmail } from './templates/new-sign-in'
import { StatusIncidentPublishedEmail } from './templates/status-incident-published'
import type { IncidentImpact } from './templates/status-incident-published'
import { StatusMaintenanceScheduledEmail } from './templates/status-maintenance-scheduled'
import { CsatRequestEmail } from './templates/csat-request'

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

/** Which outbound provider is active — for read-only admin status surfaces. */
export function getEmailProvider(): EmailProvider {
  return getProvider()
}

function getProvider(): EmailProvider {
  if (getEnv('EMAIL_SMTP_HOST')) return 'smtp'
  if (getResendApiKey()) return 'resend'
  return 'console'
}

// Recipient addresses (PII) are never logged here — log provider + ids only.
const log = createLogger({ base: { service_name: 'quackback-email' } }).child({
  component: 'email',
})

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    const host = getEnv('EMAIL_SMTP_HOST')
    const port = parseInt(getEnv('EMAIL_SMTP_PORT') || '587', 10)
    const secure = getEnv('EMAIL_SMTP_SECURE') === 'true'
    log.info({ host, port, secure }, 'initializing smtp transporter')
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
    log.info('initializing resend client')
    resendClient = new Resend(getResendApiKey())
  }
  return resendClient
}

/** Wrap a bare Message-ID in angle brackets for a header value (idempotent). */
function angleId(id: string): string {
  const bare = id.trim().replace(/^<|>$/g, '')
  return `<${bare}>`
}

/** RFC 5322 threading headers (Message-ID / In-Reply-To / References). */
interface ThreadingOptions {
  messageId?: string
  inReplyTo?: string
  references?: string[]
}

function buildThreadingHeaders(options: ThreadingOptions): Record<string, string> {
  const headers: Record<string, string> = {}
  if (options.messageId) headers['Message-ID'] = angleId(options.messageId)
  if (options.inReplyTo) headers['In-Reply-To'] = angleId(options.inReplyTo)
  if (options.references && options.references.length > 0) {
    headers['References'] = options.references.map(angleId).join(' ')
  }
  return headers
}

/**
 * Fetch a received (inbound) email's content by its Resend email id.
 * Resend's `email.received` webhook is metadata-only (no text/html body) —
 * callers use this to pull the body before parsing (#320). Returns null when
 * no Resend API key is configured or the email cannot be found; throws on
 * other errors so the webhook route can 500 and let Resend redeliver.
 */
export async function getReceivedEmail(
  emailId: string
): Promise<{ text: string | null; html: string | null } | null> {
  if (!getResendApiKey()) return null
  const { data, error } = await getResend().emails.receiving.get(emailId)
  if (error) {
    log.warn({ emailId, error: error.name }, 'received-email fetch failed')
    if (error.name === 'not_found') return null
    throw new Error(`received-email fetch failed: ${error.name}`)
  }
  return { text: data?.text ?? null, html: data?.html ?? null }
}

/**
 * The single low-level send: provider selection (SMTP → Resend → console), the
 * anon-address guard, and RFC 5322 threading. Takes an explicit From and EITHER
 * a prerendered `html` body or a `react` element (the branded senders pass
 * `react`; the raw sender passes `html`). Falls back to console when unconfigured.
 */
async function dispatch(
  options: {
    from: string
    to: string
    subject: string
    html?: string
    react?: React.ReactElement
    text?: string
    replyTo?: string
  } & ThreadingOptions
): Promise<EmailResult> {
  const threadingHeaders = buildThreadingHeaders(options)

  // Defense in depth: the synthetic anonymous placeholder domain
  // (temp-<id>@anon.quackback.io) is never deliverable. Callers sanitize via
  // realEmail(), but if one slips through, drop it here rather than bounce.
  if (isSyntheticAnonEmail(options.to)) {
    log.warn('refusing to send to synthetic anonymous address')
    return { sent: false }
  }

  const provider = getProvider()

  if (provider === 'smtp') {
    const html = options.html ?? (options.react ? await render(options.react) : undefined)
    try {
      const result = await getSmtpTransporter().sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        html,
        text: options.text,
        replyTo: options.replyTo,
        messageId: threadingHeaders['Message-ID'],
        inReplyTo: threadingHeaders['In-Reply-To'],
        references: threadingHeaders['References'],
      })
      log.info({ provider: 'smtp', message_id: result.messageId }, 'email sent')
    } catch (error) {
      // Reset transporter on connection errors so next attempt creates a fresh connection
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'ETIMEDOUT'
      ) {
        smtpTransporter = null
      }
      log.error({ err: error, provider: 'smtp' }, 'email send failed')
      throw error
    }
    return { sent: true }
  }

  if (provider === 'resend') {
    // Resend renders `react` itself; a raw send supplies `html` (+ optional text).
    const body = options.react
      ? { react: options.react }
      : { html: options.html ?? '', ...(options.text ? { text: options.text } : {}) }
    const result = await getResend().emails.send({
      from: options.from,
      to: options.to,
      subject: options.subject,
      ...body,
      replyTo: options.replyTo,
      // Resend may reassign its own Message-ID, in which case plus-address
      // routing carries the reply; In-Reply-To/References still thread the client.
      ...(Object.keys(threadingHeaders).length > 0 ? { headers: threadingHeaders } : {}),
    })
    if (result.error) {
      log.error(
        { provider: 'resend', error_name: result.error.name, error_message: result.error.message },
        'email send failed'
      )
      throw new Error(`Resend API error: ${result.error.message} (${result.error.name})`)
    }
    log.info({ provider: 'resend', message_id: result.data?.id }, 'email sent')
    return { sent: true }
  }

  // Console mode - caller handles logging
  return { sent: false }
}

/**
 * Send a branded email (rendered React template) from the workspace identity
 * (`EMAIL_FROM`). The transactional notifier — invites, notifications, alerts.
 */
async function sendEmail(
  options: {
    to: string
    subject: string
    react: React.ReactElement
    /** Conversation-specific reply address (e.g. plus-addressed inbound). */
    replyTo?: string
    /** Override the workspace EMAIL_FROM (e.g. a per-team sending address). */
    from?: string
  } & ThreadingOptions
): Promise<EmailResult> {
  const { from, ...rest } = options
  return dispatch({ from: from ?? getEmailFrom(), ...rest })
}

/** A prerendered, custom-From email (no template). */
export interface RawEmailOptions extends ThreadingOptions {
  /** Sender identity — e.g. a verified support sending address, not EMAIL_FROM. */
  from: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}

/**
 * Send a plain, prerendered email from an explicit sender address — the seam the
 * conversation email channel uses to reply as the inbox identity
 * (`channel_accounts.address`), rather than the branded `EMAIL_FROM` notifier.
 * Same provider selection, anon guard, and threading as the branded path.
 */
export async function sendRawEmail(options: RawEmailOptions): Promise<EmailResult> {
  return dispatch(options)
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
    log.debug(
      { email_type: 'InvitationEmail', to, inviteLink },
      '[dev] email preview (console provider)'
    )
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
// Portal Invite Email
// ============================================================================

interface SendPortalInviteParams {
  to: string
  workspaceName: string
  inviteLink: string
  logoUrl?: string
  personalMessage?: string
}

export async function sendPortalInviteEmail(params: SendPortalInviteParams): Promise<EmailResult> {
  const { to, workspaceName, inviteLink, logoUrl, personalMessage } = params

  if (getProvider() === 'console') {
    log.debug(
      { email_type: 'PortalInviteEmail', to, inviteLink },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `You've been invited to ${workspaceName}`,
    react: PortalInviteEmail({ workspaceName, inviteLink, logoUrl, personalMessage }),
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
    log.debug(
      { email_type: 'WelcomeEmail', to, dashboardUrl },
      '[dev] email preview (console provider)'
    )
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
    log.debug(
      { email_type: 'MagicLinkEmail', to, signInUrl, code },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  log.debug('sending sign-in email')
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
    log.debug(
      { email_type: 'PasswordResetEmail', to, resetLink },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  log.debug('sending password reset email')
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
    log.debug(
      { email_type: 'RecoveryCodeUsedEmail', to, occurredAt },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  log.debug('sending recovery-code-used alert')
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
    log.debug(
      { email_type: 'NewSignInEmail', to, occurredAt },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  log.debug('sending new-sign-in alert')
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
    log.debug(
      { email_type: 'StatusChangeEmail', to, postUrl },
      '[dev] email preview (console provider)'
    )
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
    log.debug(
      { email_type: 'NewCommentEmail', to, postUrl },
      '[dev] email preview (console provider)'
    )
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
// Conversation Email
// ============================================================================

interface SendConversationMessageEmailParams {
  to: string
  /** Phrasing differs per case: an agent reply to the visitor, a new visitor
   *  message to the team, or an agent-started outreach message to the visitor. */
  direction: 'agent_reply' | 'visitor_message' | 'agent_started'
  senderName: string
  messagePreview: string
  /** The full message body as pre-rendered, sanitized HTML. When present it is
   *  shown inline in place of the truncated `messagePreview` quote. */
  bodyHtml?: string
  /** Link to the conversation (admin inbox for agents; portal/widget for visitors). */
  ctaUrl: string
  workspaceName: string
  logoUrl?: string
  unsubscribeUrl?: string
  /** Conversation-specific reply address so a visitor's reply routes back to
   *  the right thread (inbound email channel). */
  replyTo?: string
  /** RFC 5322 threading: our deterministic Message-ID for this mail (bare or
   *  bracketed). Stored by the caller so a plus-address-stripped reply still
   *  routes back via In-Reply-To/References. */
  messageId?: string
  /** RFC 5322 threading: the parent Message-ID this mail replies to. */
  inReplyTo?: string
  /** RFC 5322 threading: the full References chain (oldest first). */
  references?: string[]
  /** Send from a per-team sending address (§4.8) instead of the branded
   *  EMAIL_FROM. Absent = the workspace default. */
  from?: string
}

/**
 * Notify someone of a conversation message when they're offline: an agent of a new
 * visitor message, or a visitor of an agent reply.
 */
export async function sendConversationMessageEmail(
  params: SendConversationMessageEmailParams
): Promise<EmailResult> {
  const {
    to,
    direction,
    senderName,
    messagePreview,
    bodyHtml,
    ctaUrl,
    workspaceName,
    logoUrl,
    unsubscribeUrl,
    replyTo,
    messageId,
    inReplyTo,
    references,
    from,
  } = params

  const isReply = direction === 'agent_reply'
  const isStarted = direction === 'agent_started'
  const heading = isReply
    ? `New reply from ${workspaceName}`
    : isStarted
      ? `New message from ${workspaceName}`
      : 'New message'
  const intro = isReply
    ? `${senderName} replied to your conversation with ${workspaceName}.`
    : isStarted
      ? `${senderName} from ${workspaceName} sent you a message.`
      : `${senderName} started a conversation in ${workspaceName}.`
  const ctaLabel = isReply || isStarted ? 'View conversation' : 'Open inbox'
  const reason = isReply
    ? 'You received this email because you have an open conversation with this team.'
    : isStarted
      ? `You received this email because ${workspaceName} sent you a message.`
      : 'You received this email because you are a member of this workspace.'
  const subject = isReply
    ? `New reply from ${workspaceName}`
    : isStarted
      ? `New message from ${workspaceName}`
      : `New message in ${workspaceName}`

  if (getProvider() === 'console') {
    log.debug(
      { email_type: 'ConversationMessageEmail', to, ctaUrl },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  return sendEmail({
    to,
    subject,
    react: ConversationMessageEmail({
      heading,
      intro,
      senderName,
      messagePreview,
      bodyHtml,
      ctaUrl,
      ctaLabel,
      organizationName: workspaceName,
      reason,
      unsubscribeUrl,
      logoUrl,
    }),
    replyTo,
    messageId,
    inReplyTo,
    references,
    from,
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
    log.debug(
      { email_type: 'PostMentionEmail', to, postUrl },
      '[dev] email preview (console provider)'
    )
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
  /** Send from the changelog module's sending address (§4.8) instead of the
   *  branded EMAIL_FROM. Absent = the workspace default. */
  from?: string
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
    from,
  } = params

  if (getProvider() === 'console') {
    log.debug(
      { email_type: 'ChangelogPublishedEmail', to, changelogUrl },
      '[dev] email preview (console provider)'
    )
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
    from,
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
    log.debug(
      { email_type: 'FeedbackLinkedEmail', to, postUrl },
      '[dev] email preview (console provider)'
    )
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
// Status Incident Published Email
// ============================================================================

interface SendStatusIncidentPublishedParams {
  to: string
  workspaceName: string
  incidentTitle: string
  impact: IncidentImpact
  statusLabel: string
  body: string
  affectedComponents: Array<{ name: string; status: string }>
  incidentUrl: string
  unsubscribeUrl: string
  logoUrl?: string
}

/** Sent once when a new incident is published on the workspace's status page. */
export async function sendStatusIncidentPublishedEmail(
  params: SendStatusIncidentPublishedParams
): Promise<EmailResult> {
  const {
    to,
    workspaceName,
    incidentTitle,
    impact,
    statusLabel,
    body,
    affectedComponents,
    incidentUrl,
    unsubscribeUrl,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    log.debug(
      { email_type: 'StatusIncidentPublishedEmail', to, incidentUrl },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `Incident: ${incidentTitle}`,
    react: StatusIncidentPublishedEmail({
      workspaceName,
      incidentTitle,
      impact,
      statusLabel,
      body,
      affectedComponents,
      incidentUrl,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// Status Maintenance Scheduled Email
// ============================================================================

interface SendStatusMaintenanceScheduledParams {
  to: string
  workspaceName: string
  maintenanceTitle: string
  body: string
  /** Pre-formatted display string for the start of the maintenance window. */
  startLabel: string
  /** Pre-formatted display string for the end of the maintenance window. */
  endLabel: string
  affectedComponents: string[]
  incidentUrl: string
  unsubscribeUrl: string
  logoUrl?: string
}

/** Sent once when maintenance is scheduled on the workspace's status page. */
export async function sendStatusMaintenanceScheduledEmail(
  params: SendStatusMaintenanceScheduledParams
): Promise<EmailResult> {
  const {
    to,
    workspaceName,
    maintenanceTitle,
    body,
    startLabel,
    endLabel,
    affectedComponents,
    incidentUrl,
    unsubscribeUrl,
    logoUrl,
  } = params

  if (getProvider() === 'console') {
    log.debug(
      { email_type: 'StatusMaintenanceScheduledEmail', to, incidentUrl },
      '[dev] email preview (console provider)'
    )
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `Scheduled maintenance: ${maintenanceTitle}`,
    react: StatusMaintenanceScheduledEmail({
      workspaceName,
      maintenanceTitle,
      body,
      startLabel,
      endLabel,
      affectedComponents,
      incidentUrl,
      unsubscribeUrl,
      logoUrl,
    }),
  })
}

// ============================================================================
// CSAT-over-email request (support platform's CSAT-over-email extension)
// ============================================================================

interface SendCsatRequestEmailParams {
  to: string
  /** The workflow block's own prompt text (plain), or '' when the block body
   *  resolved to nothing. */
  promptText: string
  /** One rating link per face (rating 1 through 5, in order) — all 5 share
   *  one signed token; only the `rating` query param differs per link. */
  ratingUrls: readonly [string, string, string, string, string]
  workspaceName: string
  logoUrl?: string
}

/** Sent by the workflow engine's send_block csat path (action.executor.ts)
 *  when the block posts on an email-channel conversation — the customer's
 *  only view of the block is their inbox, where the in-app emoji row is
 *  inert, so this carries real one-click rating links instead. */
export async function sendCsatRequestEmail(
  params: SendCsatRequestEmailParams
): Promise<EmailResult> {
  const { to, promptText, ratingUrls, workspaceName, logoUrl } = params

  if (getProvider() === 'console') {
    log.debug({ email_type: 'CsatRequestEmail', to }, '[dev] email preview (console provider)')
    return { sent: false }
  }

  return sendEmail({
    to,
    subject: `How did we do, ${workspaceName}?`,
    react: CsatRequestEmail({ promptText, ratingUrls, workspaceName, logoUrl }),
  })
}

// ============================================================================
// Re-export templates for preview/testing
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { PortalInviteEmail } from './templates/portal-invite'
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
export { StatusIncidentPublishedEmail } from './templates/status-incident-published'
export type { IncidentImpact } from './templates/status-incident-published'
export { StatusMaintenanceScheduledEmail } from './templates/status-maintenance-scheduled'
export { CsatRequestEmail } from './templates/csat-request'
