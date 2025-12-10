import { Resend } from 'resend'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { SigninCodeEmail } from './templates/signin-code'

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

// ============================================================================
// Invitation Email
// ============================================================================

interface SendInvitationParams {
  to: string
  invitedByEmail: string
  organizationName: string
  inviteLink: string
}

export async function sendInvitationEmail(params: SendInvitationParams) {
  const { to, invitedByEmail, organizationName, inviteLink } = params

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `You've been invited to join ${organizationName} on Quackback`,
    react: InvitationEmail({
      invitedByEmail,
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

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your Quackback sign-in code is ${code}`,
    react: SigninCodeEmail({ code }),
  })
}

// ============================================================================
// Exports
// ============================================================================

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
export { SigninCodeEmail } from './templates/signin-code'
