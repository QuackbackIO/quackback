import { Heading, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const SIGNUP_NOT_ALLOWED_MESSAGES = defineEmailMessages({
  subject: {
    id: 'email.signupNotAllowed.subject',
    defaultMessage: 'About your {workspace} sign-in request',
  },
  preview: { id: 'email.signupNotAllowed.preview', defaultMessage: 'About your sign-in request' },
  heading: { id: 'email.signupNotAllowed.heading', defaultMessage: 'No account for this address' },
  asked: {
    id: 'email.signupNotAllowed.asked',
    defaultMessage: 'Someone asked for a sign-in link for this email address at {workspace}.',
  },
  askedUnnamed: {
    id: 'email.signupNotAllowed.askedUnnamed',
    defaultMessage: 'Someone asked for a sign-in link for this email address at this workspace.',
  },
  noAccount: {
    id: 'email.signupNotAllowed.noAccount',
    defaultMessage:
      'There is no account here for this address, and {workspace} is not accepting new accounts. Ask an admin to invite you, then sign in with the address they invite.',
  },
  noAccountUnnamed: {
    id: 'email.signupNotAllowed.noAccountUnnamed',
    defaultMessage:
      'There is no account here for this address, and this workspace is not accepting new accounts. Ask an admin to invite you, then sign in with the address they invite.',
  },
  footer: {
    id: 'email.signupNotAllowed.footer',
    defaultMessage:
      "If you didn't request this, you can safely ignore this email. No account was created and nothing was changed.",
  },
})
const M = SIGNUP_NOT_ALLOWED_MESSAGES

interface SignupNotAllowedEmailProps {
  workspaceName?: string
  logoUrl?: string
  i18n?: EmailLocale
}

/**
 * Why no sign-in link arrived.
 *
 * The workspace refuses to open an account for this address, and the HTTP
 * response deliberately does not say so: an endpoint that answered differently
 * per address would tell any unauthenticated caller which addresses hold
 * accounts here. The inbox is the one channel that reaches only the person the
 * answer is about, so the refusal is delivered here instead.
 *
 * Carries no link and no code. There is nothing to grant, which is the point:
 * a message with no capability in it can be mailed to an address nobody has
 * proven they own.
 */
export function SignupNotAllowedEmail({
  workspaceName,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: SignupNotAllowedEmailProps) {
  const { t } = i18n
  const workspace = workspaceName
  return (
    <EmailLayout preview={t(M.preview)} logoUrl={logoUrl} showPoweredBy={false} i18n={i18n}>
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>{t(M.heading)}</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        {workspace ? t(M.asked, { workspace }) : t(M.askedUnnamed)}
      </Text>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        {workspace ? t(M.noAccount, { workspace }) : t(M.noAccountUnnamed)}
      </Text>

      <TransactionalFooter>{t(M.footer)}</TransactionalFooter>
    </EmailLayout>
  )
}
