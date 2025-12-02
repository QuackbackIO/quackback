import { Resend } from 'resend'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.EMAIL_FROM || 'Quackback <noreply@quackback.io>'

interface SendInvitationParams {
  to: string
  invitedByEmail: string
  organizationName: string
  inviteLink: string
}

export async function sendInvitationEmail(params: SendInvitationParams) {
  const { to, invitedByEmail, organizationName, inviteLink } = params

  await resend.emails.send({
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

interface SendWelcomeParams {
  to: string
  name: string
}

export async function sendWelcomeEmail(params: SendWelcomeParams) {
  const { to, name } = params

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.quackback.io'

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Welcome to Quackback!',
    react: WelcomeEmail({ name, appUrl }),
  })
}

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
