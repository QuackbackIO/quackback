import { Resend } from 'resend'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { SigninCodeEmail } from './templates/signin-code'
import { StatusChangeEmail } from './templates/status-change'
import { NewCommentEmail } from './templates/new-comment'

// Lazy initialization to avoid build errors when API key is not set
let resend: Resend | null = null

function getResend(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is not set')
    }
    resend = new Resend(apiKey)
  }
  return resend
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'Quackback <noreply@quackback.io>'

// Check if we should log emails to console instead of sending
function shouldLogToConsole(): boolean {
  return process.env.DEV_EMAIL_TO_CONSOLE === 'true'
}

// ============================================================================
// Invitation Email
// ============================================================================

interface SendInvitationParams {
  to: string
  invitedByName: string
  inviteeName?: string
  organizationName: string
  inviteLink: string
}

export async function sendInvitationEmail(params: SendInvitationParams) {
  const { to, invitedByName, inviteeName, organizationName, inviteLink } = params

  if (shouldLogToConsole()) {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Invitation Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Invitee name: ${inviteeName || '(not provided)'}`)
    console.log(`│ Invited by: ${invitedByName}`)
    console.log(`│ Organization: ${organizationName}`)
    console.log(`│ Invite link: ${inviteLink}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return
  }

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `You've been invited to join ${organizationName} on Quackback`,
    react: InvitationEmail({
      invitedByName,
      inviteeName,
      organizationName,
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

  if (shouldLogToConsole()) {
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

  await getResend().emails.send({
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

  if (shouldLogToConsole()) {
    console.log('\n┌────────────────────────────────────────────────────────────')
    console.log('│ [DEV] Sign-in Code Email')
    console.log('├────────────────────────────────────────────────────────────')
    console.log(`│ To: ${to}`)
    console.log(`│ Code: ${code}`)
    console.log('└────────────────────────────────────────────────────────────\n')
    return
  }

  await getResend().emails.send({
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
  organizationName: string
  unsubscribeUrl: string
}

export async function sendStatusChangeEmail(params: SendStatusChangeParams) {
  const { to, postTitle, postUrl, previousStatus, newStatus, organizationName, unsubscribeUrl } =
    params

  if (shouldLogToConsole()) {
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

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your feedback is now ${newStatus.replace(/_/g, ' ')}!`,
    react: StatusChangeEmail({
      postTitle,
      postUrl,
      previousStatus,
      newStatus,
      organizationName,
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
  organizationName: string
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
    organizationName,
    unsubscribeUrl,
  } = params

  if (shouldLogToConsole()) {
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

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `New comment on "${postTitle}"`,
    react: NewCommentEmail({
      postTitle,
      postUrl,
      commenterName,
      commentPreview,
      isTeamMember,
      organizationName,
      unsubscribeUrl,
    }),
  })
}

// ============================================================================
// Exports
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
export { SigninCodeEmail } from './templates/signin-code'
export { StatusChangeEmail } from './templates/status-change'
export { NewCommentEmail } from './templates/new-comment'
