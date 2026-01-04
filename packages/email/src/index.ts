/**
 * Email sending module for Quackback
 *
 * Uses Resend SDK with React Email components directly.
 * No build step required - React components are rendered at runtime.
 */

import { Resend } from 'resend'
import { SigninCodeEmail } from './templates/signin-code'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'

const FROM_EMAIL = process.env.EMAIL_FROM || 'Quackback <noreply@quackback.io>'

// Lazy-initialized Resend client
let resendClient: Resend | null = null

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null

  if (!resendClient) {
    resendClient = new Resend(apiKey)
  }
  return resendClient
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

  const resend = getResend()
  if (!resend) {
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

  await resend.emails.send({
    from: FROM_EMAIL,
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

  const resend = getResend()
  if (!resend) {
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

  await resend.emails.send({
    from: FROM_EMAIL,
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

  const resend = getResend()
  if (!resend) {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Sign-in Code Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Code: ${code}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return
  }

  await resend.emails.send({
    from: FROM_EMAIL,
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

  const resend = getResend()
  if (!resend) {
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

  await resend.emails.send({
    from: FROM_EMAIL,
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

  const resend = getResend()
  if (!resend) {
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

  await resend.emails.send({
    from: FROM_EMAIL,
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
