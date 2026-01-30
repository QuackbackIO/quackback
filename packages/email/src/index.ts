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
import { SigninCodeEmail } from './templates/signin-code'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'

const EMAIL_FROM = process.env.EMAIL_FROM || 'Quackback <noreply@quackback.io>'

// Lazy-initialized transports
let smtpTransporter: Transporter | null = null
let resendClient: Resend | null = null

type EmailProvider = 'smtp' | 'resend' | 'console'

function getProvider(): EmailProvider {
  if (process.env.EMAIL_SMTP_HOST) return 'smtp'
  if (process.env.EMAIL_RESEND_API_KEY) return 'resend'
  return 'console'
}

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    console.log('[Email] Initializing SMTP transporter')
    smtpTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_SMTP_HOST,
      port: parseInt(process.env.EMAIL_SMTP_PORT || '587', 10),
      secure: process.env.EMAIL_SMTP_SECURE === 'true',
      auth:
        process.env.EMAIL_SMTP_USER || process.env.EMAIL_SMTP_PASS
          ? {
              user: process.env.EMAIL_SMTP_USER || '',
              pass: process.env.EMAIL_SMTP_PASS || '',
            }
          : undefined,
    })
  }
  return smtpTransporter
}

function getResend(): Resend {
  if (!resendClient) {
    console.log('[Email] Initializing Resend client')
    resendClient = new Resend(process.env.EMAIL_RESEND_API_KEY)
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
}): Promise<void> {
  const provider = getProvider()

  if (provider === 'smtp') {
    const html = await render(options.react)
    const result = await getSmtpTransporter().sendMail({
      from: EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html,
    })
    console.log(`[Email] Sent via SMTP to ${options.to}, messageId: ${result.messageId}`)
    return
  }

  if (provider === 'resend') {
    const result = await getResend().emails.send({
      from: EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      react: options.react,
    })
    if (result.error) {
      console.error(`[Email] Resend API error:`, JSON.stringify(result.error, null, 2))
      throw new Error(`Resend API error: ${result.error.message} (${result.error.name})`)
    }
    console.log(`[Email] Sent via Resend to ${options.to}, id: ${result.data?.id}`)
    return
  }

  // Console mode - caller handles logging
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
}

export async function sendInvitationEmail(params: SendInvitationParams) {
  const { to, invitedByName, inviteeName, workspaceName, inviteLink } = params

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
    return
  }

  await sendEmail({
    to,
    subject: `You've been invited to join ${workspaceName} on Quackback`,
    react: InvitationEmail({
      invitedByName,
      inviteeName,
      organizationName: workspaceName,
      inviteLink,
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
}

export async function sendWelcomeEmail(params: SendWelcomeParams) {
  const { to, name, workspaceName, dashboardUrl } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Welcome Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Name: ${name}`)
    console.log(`│ Workspace: ${workspaceName}`)
    console.log(`│ Dashboard: ${dashboardUrl}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return
  }

  await sendEmail({
    to,
    subject: `Welcome to ${workspaceName} on Quackback!`,
    react: WelcomeEmail({ name, workspaceName, dashboardUrl }),
  })
}

// ============================================================================
// Sign-in Code Email
// ============================================================================

interface SendSigninCodeParams {
  to: string
  code: string
}

export async function sendSigninCodeEmail(params: SendSigninCodeParams) {
  const { to, code } = params

  if (getProvider() === 'console') {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Sign-in Code Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Code: ${code}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return
  }

  console.log(`[Email] Sending sign-in code to ${to}`)
  await sendEmail({
    to,
    subject: `Your Quackback sign-in code is ${code}`,
    react: SigninCodeEmail({ code }),
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
}

export async function sendStatusChangeEmail(params: SendStatusChangeParams) {
  const { to, postTitle, postUrl, previousStatus, newStatus, workspaceName, unsubscribeUrl } =
    params

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
    return
  }

  const formattedNewStatus = newStatus.replace(/_/g, ' ')

  await sendEmail({
    to,
    subject: `Your feedback is now ${formattedNewStatus}!`,
    react: StatusChangeEmail({
      postTitle,
      postUrl,
      previousStatus,
      newStatus,
      organizationName: workspaceName,
      unsubscribeUrl,
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
}

export async function sendNewCommentEmail(params: SendNewCommentParams) {
  const {
    to,
    postTitle,
    postUrl,
    commenterName,
    commentPreview,
    isTeamMember,
    workspaceName,
    unsubscribeUrl,
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
    return
  }

  await sendEmail({
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
    }),
  })
}

// ============================================================================
// Re-export templates for preview/testing
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
export { SigninCodeEmail } from './templates/signin-code'
export { StatusChangeEmail } from './templates/status-change'
export { NewCommentEmail } from './templates/new-comment'
