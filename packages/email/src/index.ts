/**
 * Email sending module for Quackback
 *
 * Uses the Amazon SES v2 API or Nodemailer for SMTP, with React Email
 * components. No build step required - React components are rendered at
 * runtime.
 *
 * Priority: SES (if EMAIL_SES_ACCESS_KEY_ID + EMAIL_SES_SECRET_ACCESS_KEY set)
 * → SMTP (if EMAIL_SMTP_HOST set) → Console logging (dev mode).
 *
 * The order is deliberate rather than incidental. An install that has set
 * `EMAIL_SMTP_HOST` has named the mail server it wants used and keeps it,
 * because a self-hoster with a mail server of their own has no SES credentials
 * to be overtaken by; only an install that has been given both halves of an SES
 * credential gets that path, which is a pair nobody sets by accident.
 */

import { render } from '@react-email/components'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { Resend } from 'resend'
import { createLogger } from '@quackback/logger'
import { isSyntheticAnonEmail } from './anon'
import { applyDisplayName, isSesEmailConfigured, sendViaSes } from './ses'
// Capability-bearing senders declare `to: SecureRecipient` so a contact address
// cannot be passed to one. See ./recipient for why the classes are shaped this
// way, and why the guarantee belongs here rather than at the call sites.
import type { ContactEmail, SecureRecipient } from './recipient'
export type { AccountEmail, SealedEmail, ContactEmail, SecureRecipient } from './recipient'
// Senders that may leave the platform's own address declare `from: SendingIdentity`
// for the same reason: on a shared provider account the From is a claim about
// which workspace is speaking, and the compiler is what checks it was earned.
import type { SendingIdentity } from './sender'
export type { SendingIdentity } from './sender'
import { MagicLinkEmail } from './templates/magic-link'
import { SignupNotAllowedEmail } from './templates/signup-not-allowed'
import { InvitationEmail } from './templates/invitation'
import { PortalInviteEmail } from './templates/portal-invite'
import { WelcomeEmail } from './templates/welcome'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'
import { ConversationMessageEmail } from './templates/conversation-message'
import { ConversationReplyEmail } from './templates/conversation-reply'
import { conversationMessageCopy, conversationReplySubject } from './conversation-copy'
import { ConversationClosedEmail } from './templates/conversation-closed'
import { isEmailBillable } from './mail-class'
import { PostMentionEmail } from './templates/post-mention'
import { NoteMentionEmail } from './templates/note-mention'
import { TicketEventEmail } from './templates/ticket-event'
import { ChangelogPublishedEmail } from './templates/changelog-published'
import { FeedbackLinkedEmail } from './templates/feedback-linked'
import { PasswordResetEmail } from './templates/password-reset'
import { RecoveryCodeUsedEmail } from './templates/recovery-code-used'
import { NewSignInEmail } from './templates/new-sign-in'
import { StatusIncidentPublishedEmail } from './templates/status-incident-published'
import type { IncidentImpact } from './templates/status-incident-published'
import { StatusMaintenanceScheduledEmail } from './templates/status-maintenance-scheduled'
import { CsatRequestEmail } from './templates/csat-request'
import { VerifyAddressEmail } from './templates/verify-address'

/**
 * Get environment variable at runtime.
 * Reading process.env[key] in a function prevents Vite from inlining the value.
 */
function getEnv(key: string): string | undefined {
  return process.env[key]
}

/**
 * A send refused because the install is not configured for it.
 *
 * Declares itself permanent for the same reason the transport's own errors do.
 * The conversation send path retries anything that does not say otherwise —
 * deliberately, so a new provider error name cannot quietly stop being retried
 * — and a missing environment variable is not something a second attempt
 * supplies. Without the marker a misconfiguration spends the whole backoff
 * before failing exactly as it did on the first try.
 */
export class EmailConfigError extends Error {
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

function getEmailFrom(): string {
  const from = getEnv('EMAIL_FROM')
  if (!from) {
    throw new EmailConfigError('EMAIL_FROM environment variable is required for sending emails')
  }
  return from
}

/**
 * Credential for the inbound body fetch below. Nothing outbound reads it: the
 * provider that owns this key does not carry any of our mail out, only the
 * metadata-only inbound webhook's missing body back in.
 */
function getResendApiKey(): string | undefined {
  // Support both EMAIL_RESEND_API_KEY and RESEND_API_KEY
  return getEnv('EMAIL_RESEND_API_KEY') || getEnv('RESEND_API_KEY')
}

// Lazy-initialized transports
let smtpTransporter: Transporter | null = null
let inboundFetchClient: Resend | null = null

/**
 * Why a send did not happen. Present only when `sent` is false. Both cases are
 * the system declining on purpose, so neither is a failure a caller should
 * report as one; a send that was attempted and went wrong throws instead.
 */
export type EmailNotSentReason =
  /** No provider is configured at all. The message was logged as a dev preview,
   *  which is the normal development case and not a failure. */
  | 'no_provider'
  /** The recipient was the synthetic anonymous placeholder address, which is
   *  never deliverable. Refusing it is the guard doing its job. */
  | 'anon_recipient'

export type EmailResult = {
  sent: boolean
  /** Why nothing was sent, when nothing was. See {@link EmailNotSentReason}. */
  reason?: EmailNotSentReason
  /**
   * Who owns the outbound `Message-ID` for this send, in three states.
   *
   * - **absent** — we set it, so the caller's own minted id is what went on the
   *   wire and is what a reply will quote. Every rung but SES.
   * - **a string** — the transport generated the id and told us which one, in
   *   whatever form the transport reports it. Store THIS, not the minted one:
   *   the minted one was never sent. It is not necessarily the literal token a
   *   reply quotes back — SES reports its ids without the host its header
   *   carries — so a caller comparing a quoted id to a stored one goes through
   *   the store's resolver rather than comparing strings itself.
   * - **null** — the transport generated the id and did not tell us which one.
   *   There is nothing to store, and no reply can be matched back by
   *   `Message-ID`. Callers must not fall back to their minted id here; it would
   *   record an id that exists nowhere and can only ever produce a miss.
   */
  messageId?: string | null
}

type EmailProvider = 'ses' | 'smtp' | 'console'

export function isEmailConfigured(): boolean {
  return getProvider() !== 'console'
}

/** Which outbound provider is active — for read-only admin status surfaces. */
export function getEmailProvider(): EmailProvider {
  return getProvider()
}

/**
 * The ladder, per process.
 *
 * Whole-process and nothing else: SES verifies a sending identity from a DNS
 * record its owner publishes rather than from a zone we host, so a workspace
 * sending as its own branded domain is on the same rung as everything else and
 * there is no identity this ladder has to route around.
 */
function getProvider(): EmailProvider {
  if (isSesEmailConfigured()) return 'ses'
  if (getEnv('EMAIL_SMTP_HOST')) return 'smtp'
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

/** Client for the inbound body fetch below, never for sending. */
function getInboundFetchClient(): Resend {
  if (!inboundFetchClient) {
    log.info('initializing inbound email fetch client')
    inboundFetchClient = new Resend(getResendApiKey())
  }
  return inboundFetchClient
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
  extraHeaders?: Record<string, string>
}

export interface EmailLogSinkEntry {
  direction: 'outbound'
  emailType: string
  provider: string
  to: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  messageId?: string | null
  providerMessageId?: string | null
  error?: string
  billable: boolean
  conversationId?: string | null
  ticketId?: string | null
  postId?: string | null
}

export type EmailLogSink = (entry: EmailLogSinkEntry) => void | Promise<void>

let emailLogSink: EmailLogSink | null = null

/** Registered by apps/web. The sink must never throw; dispatch swallows sink errors. */
export function setEmailLogSink(sink: EmailLogSink | null): void {
  emailLogSink = sink
}

function entityIds(options: {
  conversationId?: string | null
  ticketId?: string | null
  postId?: string | null
}): Pick<EmailLogSinkEntry, 'conversationId' | 'ticketId' | 'postId'> {
  return {
    conversationId: options.conversationId,
    ticketId: options.ticketId,
    postId: options.postId,
  }
}

function recordOutboundLog(entry: EmailLogSinkEntry): void {
  if (!emailLogSink) return
  try {
    void Promise.resolve(emailLogSink(entry)).catch(() => undefined)
  } catch {
    // A ledger failure must never block a send.
  }
}

function buildThreadingHeaders(options: ThreadingOptions): Record<string, string> {
  const headers: Record<string, string> = { ...(options.extraHeaders ?? {}) }
  if (options.messageId) headers['Message-ID'] = angleId(options.messageId)
  if (options.inReplyTo) headers['In-Reply-To'] = angleId(options.inReplyTo)
  if (options.references && options.references.length > 0) {
    headers['References'] = options.references.map(angleId).join(' ')
  }
  return headers
}

/**
 * Fetch a received (inbound) email's content by its provider email id.
 * The `email.received` webhook is metadata-only (no text/html body) —
 * callers use this to pull the body before parsing (#320). Returns null when
 * no inbound API key is configured or the email cannot be found; throws on
 * other errors so the webhook route can 500 and let the provider redeliver.
 *
 * The only consumer of the inbound credential. Outbound mail leaves by the
 * ladder above and never touches this client.
 */
export async function getReceivedEmail(
  emailId: string
): Promise<{ text: string | null; html: string | null } | null> {
  if (!getResendApiKey()) return null
  const { data, error } = await getInboundFetchClient().emails.receiving.get(emailId)
  if (error) {
    log.warn({ emailId, error: error.name }, 'received-email fetch failed')
    if (error.name === 'not_found') return null
    throw new Error(`received-email fetch failed: ${error.name}`)
  }
  return { text: data?.text ?? null, html: data?.html ?? null }
}

/**
 * The single low-level send: provider selection (SES → SMTP → console), the
 * anon-address guard, and RFC 5322 threading. Takes EITHER a
 * prerendered `html` body or a `react` element (the branded senders pass
 * `react`; the raw sender passes `html`). Falls back to console when
 * unconfigured.
 *
 * Every send goes through here, including the console preview, so no caller has
 * to know which provider is active.
 */
async function dispatch(
  options: {
    /** Omit to use the workspace EMAIL_FROM; the raw sender passes its own. */
    from?: SendingIdentity
    to: string
    subject: string
    html?: string
    react?: React.ReactElement
    text?: string
    replyTo?: string
    /** Template name, for the dev preview line. */
    emailType?: string
    /** Extra identifying fields for the dev preview line (links, codes). */
    preview?: Record<string, unknown>
    /** Display name wrapped around `from` (or EMAIL_FROM) as RFC 5322. */
    fromDisplayName?: string
    conversationId?: string | null
    ticketId?: string | null
    postId?: string | null
  } & ThreadingOptions
): Promise<EmailResult> {
  const threadingHeaders = buildThreadingHeaders(options)

  // Defense in depth: the synthetic anonymous placeholder domain
  // (temp-<id>@anon.quackback.io) is never deliverable. Callers sanitize via
  // realEmail(), but if one slips through, drop it here rather than bounce.
  if (isSyntheticAnonEmail(options.to)) {
    log.warn('refusing to send to synthetic anonymous address')
    recordOutboundLog({
      direction: 'outbound',
      emailType: options.emailType ?? 'RawEmail',
      provider: getProvider(),
      to: options.to,
      subject: options.subject,
      status: 'skipped',
      billable: false,
      ...entityIds(options),
    })
    return { sent: false, reason: 'anon_recipient' }
  }

  const provider = getProvider()

  // Console provider never sends. Handled before `from` is resolved because
  // getEmailFrom() throws when EMAIL_FROM is unset, which is the normal dev
  // case and must not stop a preview from being logged.
  const emailType = options.emailType ?? 'RawEmail'
  const billable = isEmailBillable(emailType)

  if (provider === 'console') {
    // Said out loud, once per dropped message. The other two rungs announce
    // themselves when they initialize; this one delivers nothing and its
    // preview sits at `debug`, so a production deploy that dropped every
    // notification used to emit no line at all while callers read `sent: false`
    // as routine. Kept apart from the preview line because that one carries the
    // recipient, and an address does not belong at a level anyone ships.
    log.warn(
      { provider: 'console', email_type: emailType },
      'no email provider configured: message logged as a preview and not delivered'
    )
    log.debug(
      { email_type: emailType, to: options.to, ...options.preview },
      '[dev] email preview (console provider)'
    )
    recordOutboundLog({
      direction: 'outbound',
      emailType,
      provider: 'console',
      to: options.to,
      subject: options.subject,
      status: 'skipped',
      billable: false,
      ...entityIds(options),
    })
    return { sent: false, reason: 'no_provider' }
  }

  const resolvedFrom = options.from ?? getEmailFrom()
  const from = options.fromDisplayName
    ? applyDisplayName(resolvedFrom, options.fromDisplayName)
    : resolvedFrom
  const html = options.html ?? (options.react ? await render(options.react) : undefined)
  const text =
    options.text ?? (options.react ? await render(options.react, { plainText: true }) : undefined)

  if (provider === 'ses') {
    // Message-ID is platform-controlled: the transport drops ours on the way
    // out and reports back the one SES assigned. In-Reply-To and References are
    // allowed and pass through, which is what keeps the recipient's mail client
    // threading. What is lost is our ability to CHOOSE the id; the Message-ID
    // route home survives because the caller records the assigned one instead
    // of the minted one.
    const result = await sendViaSes({
      from,
      to: options.to,
      subject: options.subject,
      ...(html !== undefined ? { html } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}),
      ...(Object.keys(threadingHeaders).length > 0 ? { headers: threadingHeaders } : {}),
    })
    // The id as the provider reported it, which is what its delivery events and
    // the threading map both name the message by. A raw inbound header quotes
    // the same id at a host, so a search across the two has to expect the pair.
    log.info({ provider: 'ses', message_id: result.messageId }, 'email sent')
    recordOutboundLog({
      direction: 'outbound',
      emailType,
      provider: 'ses',
      to: options.to,
      subject: options.subject,
      status: 'sent',
      messageId: result.messageId,
      providerMessageId: result.messageId,
      billable,
      ...entityIds(options),
    })
    return { sent: true, messageId: result.messageId }
  }

  // SMTP is the last rung: console and SES both returned above.
  try {
    const result = await getSmtpTransporter().sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html,
      text,
      replyTo: options.replyTo,
      messageId: threadingHeaders['Message-ID'],
      inReplyTo: threadingHeaders['In-Reply-To'],
      references: threadingHeaders['References'],
      headers: options.extraHeaders,
    })
    log.info({ provider: 'smtp', message_id: result.messageId }, 'email sent')
    recordOutboundLog({
      direction: 'outbound',
      emailType,
      provider: 'smtp',
      to: options.to,
      subject: options.subject,
      status: 'sent',
      messageId: result.messageId,
      providerMessageId: result.messageId,
      billable,
      ...entityIds(options),
    })
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
    recordOutboundLog({
      direction: 'outbound',
      emailType,
      provider: 'smtp',
      to: options.to,
      subject: options.subject,
      status: 'failed',
      error: error instanceof Error ? error.message : 'send failed',
      billable,
      ...entityIds(options),
    })
    throw error
  }
  return { sent: true }
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
    from?: SendingIdentity
    /** Template name, for the dev preview line. */
    emailType?: string
    /** Extra identifying fields for the dev preview line (links, codes). */
    preview?: Record<string, unknown>
    fromDisplayName?: string
    conversationId?: string | null
    ticketId?: string | null
    postId?: string | null
  } & ThreadingOptions
): Promise<EmailResult> {
  return dispatch(options)
}

/** A prerendered, custom-From email (no template). */
export interface RawEmailOptions extends ThreadingOptions {
  /** Sender identity — e.g. a verified support sending address, not EMAIL_FROM. */
  from: SendingIdentity
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
  to: SecureRecipient
  invitedByName: string
  inviteeName?: string
  workspaceName: string
  inviteLink: string
  logoUrl?: string
}

export async function sendInvitationEmail(params: SendInvitationParams): Promise<EmailResult> {
  const { to, invitedByName, inviteeName, workspaceName, inviteLink, logoUrl } = params

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
    emailType: 'InvitationEmail',
    preview: { inviteLink },
  })
}

// ============================================================================
// Portal Invite Email
// ============================================================================

interface SendPortalInviteParams {
  to: SecureRecipient
  workspaceName: string
  inviteLink: string
  logoUrl?: string
  personalMessage?: string
}

export async function sendPortalInviteEmail(params: SendPortalInviteParams): Promise<EmailResult> {
  const { to, workspaceName, inviteLink, logoUrl, personalMessage } = params

  return sendEmail({
    to,
    subject: `You've been invited to ${workspaceName}`,
    react: PortalInviteEmail({ workspaceName, inviteLink, logoUrl, personalMessage }),
    emailType: 'PortalInviteEmail',
    preview: { inviteLink },
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

  return sendEmail({
    to,
    subject: `Welcome to ${workspaceName} on Quackback!`,
    react: WelcomeEmail({ name, workspaceName, dashboardUrl, logoUrl }),
    emailType: 'WelcomeEmail',
    preview: { dashboardUrl },
  })
}

// ============================================================================
// Sign-in Email (magic link + 6-digit code combined)
// ============================================================================

interface SendMagicLinkParams {
  to: SecureRecipient
  signInUrl: string
  code: string
  logoUrl?: string
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<EmailResult> {
  const { to, signInUrl, code, logoUrl } = params

  log.debug('sending sign-in email')
  return sendEmail({
    to,
    subject: 'Your Quackback sign-in link',
    react: MagicLinkEmail({ signInUrl, code, logoUrl }),
    emailType: 'MagicLinkEmail',
    preview: { signInUrl, code },
  })
}

// ============================================================================
// Sign-in refused (no account, and the workspace is not accepting new ones)
// ============================================================================

interface SendSignupNotAllowedParams {
  /**
   * `ContactEmail`, not a `SecureRecipient`. The address was typed by whoever
   * filled in the form, so nobody has proven they own it — and this message is
   * deliberately the one kind that may go to such an address, because it grants
   * nothing. No link, no code, no account.
   */
  to: ContactEmail
  workspaceName?: string
  logoUrl?: string
}

/**
 * Sent instead of a sign-in link when the workspace refuses to open an account
 * for the address. The HTTP response is identical either way, so this is the
 * only place the reason is stated, and it reaches only the address it is about.
 */
export async function sendSignupNotAllowedEmail(
  params: SendSignupNotAllowedParams
): Promise<EmailResult> {
  const { to, workspaceName, logoUrl } = params

  log.debug('sending sign-in refusal email')
  return sendEmail({
    to,
    subject: 'About your Quackback sign-in request',
    react: SignupNotAllowedEmail({ workspaceName, logoUrl }),
    emailType: 'SignupNotAllowedEmail',
  })
}

// ============================================================================
// Password Reset Email
// ============================================================================

interface SendPasswordResetParams {
  to: SecureRecipient
  resetLink: string
  logoUrl?: string
}

export async function sendPasswordResetEmail(
  params: SendPasswordResetParams
): Promise<EmailResult> {
  const { to, resetLink, logoUrl } = params

  log.debug('sending password reset email')
  return sendEmail({
    to,
    subject: 'Reset your Quackback password',
    react: PasswordResetEmail({ resetLink, logoUrl }),
    emailType: 'PasswordResetEmail',
    preview: { resetLink },
  })
}

// ============================================================================
// Recovery code used (security alert)
// ============================================================================

interface SendRecoveryCodeUsedParams {
  to: SecureRecipient
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

  log.debug('sending recovery-code-used alert')
  return sendEmail({
    to,
    subject: 'A recovery code on your account was just used',
    react: RecoveryCodeUsedEmail({ workspaceName, ipAddress, userAgent, occurredAt, logoUrl }),
    emailType: 'RecoveryCodeUsedEmail',
    preview: { occurredAt },
  })
}

// ============================================================================
// New-device sign-in notification
// ============================================================================

interface SendNewSignInParams {
  to: SecureRecipient
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

  log.debug('sending new-sign-in alert')
  return sendEmail({
    to,
    subject: 'New sign-in to your account',
    react: NewSignInEmail({ workspaceName, occurredAt, ipAddress, userAgent, logoUrl }),
    emailType: 'NewSignInEmail',
    preview: { occurredAt },
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
  preferencesUrl?: string
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
    preferencesUrl,
    logoUrl,
  } = params

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
      preferencesUrl,
      logoUrl,
    }),
    emailType: 'StatusChangeEmail',
    preview: { postUrl },
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
  preferencesUrl?: string
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
    preferencesUrl,
    logoUrl,
  } = params

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
      preferencesUrl,
      logoUrl,
    }),
    emailType: 'NewCommentEmail',
    preview: { postUrl },
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
  from?: SendingIdentity
  /**
   * Active conversation channel. `email` selects the human reply template for
   * agent correspondence; messenger keeps the notification card.
   */
  channel?: string
  /** Stored `conversations.subject`; when set, visitor-facing mail uses `Re:`. */
  conversationSubject?: string | null
  /** Team-alert copy: first visitor message vs a follow-up. */
  isFirstMessage?: boolean
  /** Their-surface correspondence (email today). Overrides the channel string gate. */
  correspondence?: boolean
  /** Immediately previous message, quoted one level on the human template. */
  quotedPrevious?: { date: Date | string; name: string; text: string }
  /** Display name for the From header (`Alex (Acme)`). */
  fromDisplayName?: string
  conversationId?: string | null
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
    replyTo,
    messageId,
    inReplyTo,
    references,
    from,
    channel,
    conversationSubject,
    isFirstMessage,
    correspondence,
    quotedPrevious,
    fromDisplayName,
    conversationId,
  } = params

  const copy = conversationMessageCopy({
    direction,
    senderName,
    workspaceName,
    conversationSubject,
    preview: messagePreview,
    channel,
    isFirstMessage,
    correspondence,
  })

  const react = copy.useHumanTemplate
    ? ConversationReplyEmail({
        bodyHtml,
        messagePreview,
        agentName: senderName,
        teamName: workspaceName,
        viewUrl: ctaUrl,
        quotedPrevious,
      })
    : ConversationMessageEmail({
        heading: copy.heading,
        intro: copy.intro,
        senderName,
        messagePreview,
        bodyHtml,
        ctaUrl,
        ctaLabel: copy.ctaLabel,
        organizationName: workspaceName,
        reason: copy.reason,
        logoUrl,
      })

  return sendEmail({
    to,
    subject: copy.subject,
    react,
    replyTo,
    messageId,
    inReplyTo,
    references,
    from,
    fromDisplayName,
    conversationId,
    emailType: copy.useHumanTemplate ? 'ConversationReplyEmail' : 'ConversationMessageEmail',
    preview: { ctaUrl },
  })
}

export async function sendConversationClosedEmail(params: {
  to: string
  workspaceName: string
  variant: 'closed' | 'auto_closed'
  conversationSubject?: string | null
  viewUrl?: string
  csatPrompt?: string
  ratingUrls?: readonly [string, string, string, string, string]
  replyTo?: string
  from?: SendingIdentity
  fromDisplayName?: string
  messageId?: string
  inReplyTo?: string
  references?: string[]
  conversationId?: string | null
}): Promise<EmailResult> {
  const subject =
    conversationReplySubject(params.conversationSubject) ??
    `Re: your conversation with ${params.workspaceName}`
  return sendEmail({
    to: params.to,
    subject,
    react: ConversationClosedEmail({
      workspaceName: params.workspaceName,
      variant: params.variant,
      viewUrl: params.viewUrl,
      csatPrompt: params.csatPrompt,
      ratingUrls: params.ratingUrls,
    }),
    replyTo: params.replyTo,
    from: params.from,
    fromDisplayName: params.fromDisplayName,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    conversationId: params.conversationId,
    emailType: 'ConversationClosedEmail',
  })
}

export async function sendConversationAutoAckEmail(params: {
  to: string
  workspaceName: string
  conversationSubject?: string | null
  replyTo?: string
  messageId?: string
  inReplyTo?: string
  references?: string[]
  from?: SendingIdentity
  conversationId?: string | null
}): Promise<EmailResult> {
  const subject =
    conversationReplySubject(params.conversationSubject) ??
    `Re: your message to ${params.workspaceName}`
  return sendEmail({
    to: params.to,
    subject,
    react: ConversationReplyEmail({
      bodyHtml: `<p>We received your email and will get back to you shortly.</p>`,
      messagePreview: 'We received your email and will get back to you shortly.',
      agentName: params.workspaceName,
      teamName: params.workspaceName,
    }),
    replyTo: params.replyTo,
    from: params.from,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    conversationId: params.conversationId,
    extraHeaders: {
      'Auto-Submitted': 'auto-replied',
      Precedence: 'auto_reply',
    },
    emailType: 'ConversationAutoAckEmail',
  })
}

// ============================================================================
// Ticket Event Email (support platform: watcher/lifecycle notifications)
// ============================================================================

export type TicketEmailKind =
  | 'created'
  | 'reply'
  | 'status_resolved'
  | 'assigned'
  | 'assigned_team'
  | 'sla_warning'
  | 'sla_breach'

export interface SendTicketEventEmailParams {
  to: string
  kind: TicketEmailKind
  /** Formatted ticket reference, e.g. "#142". */
  ticketLabel: string
  /** Ticket title (or, for SLA kinds, the counterpart identifier). */
  title: string
  workspaceName: string
  ctaUrl: string
  /** Reply body (kind 'reply'): full markdown rendered to plain text. */
  messageBody?: string
  /** Reply author display name (kind 'reply'). */
  authorName?: string
  /** Stage labels (kind 'status_resolved'). */
  statusChange?: { previousLabel: string | null; newLabel: string }
  /** B22: kind 'status_resolved' — a null-publicStage close ("Won't do",
   *  "Duplicate") renders generic "was closed" copy instead of "was resolved",
   *  so the internal status name never reaches the customer. */
  closedGeneric?: boolean
  /** SLA kinds: which clock and when it is/was due. */
  clockLabel?: string
  dueLabel?: string
  preferencesUrl?: string
  logoUrl?: string
  /** Per-team sending address override; absent = branded EMAIL_FROM. */
  from?: SendingIdentity
  /** Per-ticket inbound reply address (reply-by-email); absent = no Reply-To. */
  replyTo?: string
  messageId?: string
  inReplyTo?: string
  references?: string[]
}

interface TicketEmailCopy {
  subject: string
  heading: string
  intro: string
  ctaLabel: string
  reason: string
  note?: string
  factLine?: string
}

/**
 * Per-kind copy, derived from structured facts — the sendConversationMessageEmail
 * `direction` pattern generalized to the seven ticket kinds. The app passes
 * facts (labels, names, times), never prose.
 */
function ticketEventCopy(p: SendTicketEventEmailParams): TicketEmailCopy {
  const requesterReason = `You're receiving this because you opened ticket ${p.ticketLabel} at ${p.workspaceName}.`
  switch (p.kind) {
    case 'created':
      return {
        subject: `We received your ticket ${p.ticketLabel}: ${p.title}`,
        heading: "We've got your ticket",
        intro: `Your ticket ${p.ticketLabel} "${p.title}" is with the ${p.workspaceName} team. We'll email you as soon as there's a reply.`,
        ctaLabel: 'View your ticket',
        reason: requesterReason,
      }
    case 'reply':
      return {
        subject: `New reply on ${p.ticketLabel}: ${p.title}`,
        heading: 'New reply on your ticket',
        intro: `${p.authorName ?? 'The team'} replied to ${p.ticketLabel} "${p.title}":`,
        ctaLabel: 'View your ticket',
        reason: requesterReason,
      }
    case 'status_resolved':
      // B22: a null-publicStage close ("Won't do", "Duplicate") says "closed",
      // never "resolved" — the internal status name must not leak, and the
      // customer story for a won't-do close is a plain close.
      if (p.closedGeneric) {
        return {
          subject: `Your ticket ${p.ticketLabel} was closed`,
          heading: 'Your ticket was closed',
          intro: `${p.ticketLabel} "${p.title}" has been closed by the ${p.workspaceName} team.`,
          note: 'If you have a follow-up, reply on the ticket thread — replying reopens it.',
          ctaLabel: 'View your ticket',
          reason: requesterReason,
        }
      }
      return {
        subject: `Your ticket ${p.ticketLabel} was resolved`,
        heading: 'Your ticket was resolved',
        intro: `${p.ticketLabel} "${p.title}" has been marked resolved by the ${p.workspaceName} team.`,
        note: "Reply on the ticket thread if this isn't fixed for you; replying reopens it.",
        ctaLabel: 'View your ticket',
        reason: requesterReason,
      }
    case 'assigned':
      return {
        subject: `Ticket ${p.ticketLabel} assigned to you`,
        heading: 'You were assigned a ticket',
        intro: `${p.ticketLabel} "${p.title}" was assigned to you.`,
        ctaLabel: 'Open in inbox',
        reason: "You're receiving this because the ticket was assigned to you.",
      }
    case 'assigned_team':
      return {
        subject: `Ticket ${p.ticketLabel} assigned to your team`,
        heading: 'A ticket was assigned to your team',
        intro: `${p.ticketLabel} "${p.title}" was assigned to your team.`,
        ctaLabel: 'Open in inbox',
        reason: "You're receiving this because the ticket was assigned to your team.",
      }
    case 'sla_warning':
      return {
        subject: `SLA at risk: ${p.clockLabel ?? 'response'} due ${p.dueLabel ?? 'soon'}`,
        heading: `${capitalize(p.clockLabel ?? 'Response')} SLA approaching breach`,
        intro: `The conversation with ${p.title} needs a ${p.clockLabel ?? 'response'} soon.`,
        factLine: `${capitalize(p.clockLabel ?? 'Response')} due ${p.dueLabel ?? 'soon'}`,
        ctaLabel: 'Open in inbox',
        reason: "You're receiving this because you're responsible for this conversation.",
      }
    case 'sla_breach':
      return {
        subject: `SLA breached: ${p.clockLabel ?? 'response'} for ${p.title}`,
        heading: `${capitalize(p.clockLabel ?? 'Response')} SLA breached`,
        intro: `The conversation with ${p.title} has passed its ${p.clockLabel ?? 'response'} target.`,
        factLine: `${capitalize(p.clockLabel ?? 'Response')} was due ${p.dueLabel ?? 'earlier'}`,
        ctaLabel: 'Open in inbox',
        reason: "You're receiving this because you're responsible for this conversation.",
      }
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

/** Send one of the seven ticket lifecycle emails (single template + copy map). */
export async function sendTicketEventEmail(
  params: SendTicketEventEmailParams
): Promise<EmailResult> {
  const copy = ticketEventCopy(params)

  return sendEmail({
    to: params.to,
    subject: copy.subject,
    react: TicketEventEmail({
      heading: copy.heading,
      intro: copy.intro,
      messageBody: params.messageBody,
      authorName: params.authorName,
      statusChange: params.statusChange,
      factLine: copy.factLine,
      note: copy.note,
      ctaUrl: params.ctaUrl,
      ctaLabel: copy.ctaLabel,
      organizationName: params.workspaceName,
      reason: copy.reason,
      preferencesUrl: params.preferencesUrl,
      logoUrl: params.logoUrl,
    }),
    from: params.from,
    replyTo: params.replyTo,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    emailType: 'TicketEventEmail',
    preview: {
      kind: params.kind,
      ctaUrl: params.ctaUrl,
    },
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
  preferencesUrl?: string
  logoUrl?: string
}

export async function sendPostMentionEmail(args: SendPostMentionEmailArgs): Promise<EmailResult> {
  const {
    to,
    mentionerName,
    postTitle,
    excerpt,
    postUrl,
    workspaceName,
    unsubscribeUrl,
    preferencesUrl,
    logoUrl,
  } = args

  const displayName = mentionerName || 'Anonymous user'
  const subject = `${displayName} mentioned you in "${postTitle}"`

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
      preferencesUrl,
      logoUrl,
    }),
    emailType: 'PostMentionEmail',
    preview: { postUrl },
  })
}

// ============================================================================
// Note Mention Email
// ============================================================================

export interface SendNoteMentionEmailArgs {
  to: string
  /** Teammate who wrote the note. */
  authorName: string
  /** Plain-text note preview. Empty string suppresses the quote block. */
  preview: string
  /** Admin inbox deep link. */
  conversationUrl: string
  workspaceName: string
  preferencesUrl?: string
  logoUrl?: string
  /** RFC 5322 threading: this mail's own Message-ID (bare or bracketed). */
  messageId?: string
  /** RFC 5322 threading: the note-thread root this alert replies to. */
  inReplyTo?: string
  /** RFC 5322 threading: the full References chain (oldest first). */
  references?: string[]
}

/** Alert a teammate @-mentioned in an internal note on a conversation. */
export async function sendNoteMentionEmail(args: SendNoteMentionEmailArgs): Promise<EmailResult> {
  const {
    to,
    authorName,
    preview,
    conversationUrl,
    workspaceName,
    preferencesUrl,
    logoUrl,
    messageId,
    inReplyTo,
    references,
  } = args

  const displayName = authorName || 'A teammate'

  return sendEmail({
    to,
    subject: `${displayName} mentioned you in an internal note`,
    react: NoteMentionEmail({
      authorName,
      preview,
      conversationUrl,
      workspaceName,
      preferencesUrl,
      logoUrl,
    }),
    messageId,
    inReplyTo,
    references,
    emailType: 'NoteMentionEmail',
    preview: { conversationUrl },
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
  /** The entry's full body as pre-rendered, sanitized HTML. When present it
   *  replaces the truncated `contentPreview` so the reader gets the whole
   *  update — formatting and images — inline. */
  contentHtml?: string
  workspaceName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
  /** Send from the changelog module's sending address (§4.8) instead of the
   *  branded EMAIL_FROM. Absent = the workspace default. */
  from?: SendingIdentity
}

export async function sendChangelogPublishedEmail(
  params: SendChangelogPublishedParams
): Promise<EmailResult> {
  const {
    to,
    changelogTitle,
    changelogUrl,
    contentPreview,
    contentHtml,
    workspaceName,
    unsubscribeUrl,
    preferencesUrl,
    logoUrl,
    from,
  } = params

  return sendEmail({
    to,
    subject: `New update: ${changelogTitle}`,
    react: ChangelogPublishedEmail({
      changelogTitle,
      changelogUrl,
      contentPreview,
      bodyHtml: contentHtml,
      organizationName: workspaceName,
      unsubscribeUrl,
      preferencesUrl,
      logoUrl,
    }),
    from,
    emailType: 'ChangelogPublishedEmail',
    preview: { changelogUrl },
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
  preferencesUrl?: string
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
    preferencesUrl,
    attributedByName,
    logoUrl,
  } = params

  return sendEmail({
    to,
    subject: `Your feedback has been linked to "${postTitle}"`,
    react: FeedbackLinkedEmail({
      recipientName,
      postTitle,
      postUrl,
      workspaceName,
      unsubscribeUrl,
      preferencesUrl,
      attributedByName,
      logoUrl,
    }),
    emailType: 'FeedbackLinkedEmail',
    preview: { postUrl },
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
  preferencesUrl?: string
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
    preferencesUrl,
    logoUrl,
  } = params

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
      preferencesUrl,
      logoUrl,
    }),
    emailType: 'StatusIncidentPublishedEmail',
    preview: { incidentUrl },
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
  preferencesUrl?: string
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
    preferencesUrl,
    logoUrl,
  } = params

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
      preferencesUrl,
      logoUrl,
    }),
    emailType: 'StatusMaintenanceScheduledEmail',
    preview: { incidentUrl },
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
  /**
   * The same From the conversation's replies go out as; absent = the workspace
   * default.
   *
   * Carried rather than defaulted because this arrives in the middle of a
   * thread. A conversation answered from the customer's own support address
   * whose rating prompt came from the platform address is a thread that changes
   * identity halfway through, which reads as a different sender to the person
   * being asked and to their mail client's threading.
   */
  from?: SendingIdentity
  conversationId?: string | null
}

/** Sent by the workflow engine's send_block csat path (action.executor.ts)
 *  when the block posts on an email-channel conversation — the customer's
 *  only view of the block is their inbox, where the in-app emoji row is
 *  inert, so this carries real one-click rating links instead. */
export async function sendCsatRequestEmail(
  params: SendCsatRequestEmailParams
): Promise<EmailResult> {
  const { to, promptText, ratingUrls, workspaceName, logoUrl, from, conversationId } = params

  return sendEmail({
    to,
    subject: 'How did we do?',
    react: CsatRequestEmail({ promptText, ratingUrls, workspaceName, logoUrl }),
    from,
    conversationId,
    emailType: 'CsatRequestEmail',
  })
}

// ============================================================================
// Re-export templates for preview/testing
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { PortalInviteEmail } from './templates/portal-invite'
export { WelcomeEmail } from './templates/welcome'
export { MagicLinkEmail } from './templates/magic-link'
export { SignupNotAllowedEmail } from './templates/signup-not-allowed'
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
export { CsatRequestEmail, CSAT_FACES as CSAT_REQUEST_EMAIL_FACES } from './templates/csat-request'
export { ConversationReplyEmail } from './templates/conversation-reply'
export { ConversationMessageEmail } from './templates/conversation-message'
export {
  conversationReplySubject,
  conversationMessageCopy,
  assembleOutboundThreading,
  isHumanReplyTemplate,
  agentReplyDisplayName,
  teamAlertSubject,
} from './conversation-copy'
export { ConversationClosedEmail } from './templates/conversation-closed'
export { EMAIL_BILLABLE, isEmailBillable } from './mail-class'

// ============================================================================
// Address verification (add or change)
// ============================================================================

export interface SendVerifyAddressEmailParams {
  to: string
  code: string
  workspaceName?: string
  logoUrl?: string
}

/**
 * Proof of control for an address someone is adding to, or moving, their
 * account. Contact class: the code proves the address, it does not grant
 * anything on its own.
 */
export async function sendVerifyAddressEmail(
  params: SendVerifyAddressEmailParams
): Promise<EmailResult> {
  const { to, code, workspaceName, logoUrl } = params
  log.debug('sending address verification code')
  return sendEmail({
    to,
    subject: 'Confirm your email address',
    react: VerifyAddressEmail({ code, workspaceName, logoUrl }),
    emailType: 'VerifyAddressEmail',
  })
}
