import { Resend } from 'resend'
import { InvitationEmail } from './templates/invitation'
import { WelcomeEmail } from './templates/welcome'
import { FindWorkspacesEmail } from './templates/find-workspaces'

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

interface SendWelcomeParams {
  to: string
  name: string
}

export async function sendWelcomeEmail(params: SendWelcomeParams) {
  const { to, name } = params

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.quackback.io'

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Welcome to Quackback!',
    react: WelcomeEmail({ name, appUrl }),
  })
}

interface Workspace {
  name: string
  slug: string
  loginUrl: string
}

interface SendFindWorkspacesParams {
  to: string
  workspaces: Workspace[]
}

export async function sendFindWorkspacesEmail(params: SendFindWorkspacesParams) {
  const { to, workspaces } = params

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject:
      workspaces.length > 0
        ? `Your Quackback workspaces (${workspaces.length} found)`
        : 'Your Quackback workspaces',
    react: FindWorkspacesEmail({ workspaces }),
  })
}

export { InvitationEmail } from './templates/invitation'
export { WelcomeEmail } from './templates/welcome'
export { FindWorkspacesEmail } from './templates/find-workspaces'
