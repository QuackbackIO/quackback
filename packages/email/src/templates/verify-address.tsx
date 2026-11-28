import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const VERIFY_ADDRESS_MESSAGES = defineEmailMessages({
  subject: { id: 'email.verifyAddress.subject', defaultMessage: 'Confirm your email address' },
  preview: { id: 'email.verifyAddress.preview', defaultMessage: 'Your verification code' },
  previewNamed: {
    id: 'email.verifyAddress.previewNamed',
    defaultMessage: 'Your verification code for {workspace}',
  },
  heading: { id: 'email.verifyAddress.heading', defaultMessage: 'Confirm your email' },
  body: {
    id: 'email.verifyAddress.body',
    defaultMessage: 'Enter this code to confirm this address. It expires in 10 minutes.',
  },
  bodyNamed: {
    id: 'email.verifyAddress.bodyNamed',
    defaultMessage:
      'Enter this code for {workspace} to confirm this address. It expires in 10 minutes.',
  },
  ignore: {
    id: 'email.verifyAddress.ignore',
    defaultMessage: "If you didn't ask for this, ignore it. Nothing changes without the code.",
  },
  footer: {
    id: 'email.verifyAddress.footer',
    defaultMessage:
      "You're receiving this because someone entered this address on an account. It won't be used for anything until it's confirmed.",
  },
})
const M = VERIFY_ADDRESS_MESSAGES

interface VerifyAddressEmailProps {
  code: string
  workspaceName?: string
  logoUrl?: string
  i18n?: EmailLocale
}

/**
 * Proves control of an address someone is adding to, or moving, their account.
 *
 * Deliberately NOT the sign-in template. That one is headed "Sign in to
 * Quackback", and showing it to someone who just asked to change their address
 * reads as a phishing attempt — the action they took and the mail they received
 * would not match. Same code presentation, different sentence.
 *
 * There is no link. The person is already in the app, on the page that asked
 * for the address, so a code they type back keeps them in that context and
 * gives a cross-device link no chance to be intercepted.
 */
export function VerifyAddressEmail({
  code,
  workspaceName,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: VerifyAddressEmailProps) {
  const { t } = i18n
  const workspace = workspaceName
  return (
    <EmailLayout
      preview={workspace ? t(M.previewNamed, { workspace }) : t(M.preview)}
      logoUrl={logoUrl}
      i18n={i18n}
    >
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>{t(M.heading)}</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        {workspace ? t(M.bodyNamed, { workspace }) : t(M.body)}
      </Text>
      <Section style={utils.codeBox}>
        <Text style={utils.code}>{code}</Text>
      </Section>
      <Text style={{ ...typography.footer, textAlign: 'center' }}>{t(M.ignore)}</Text>
      <TransactionalFooter>{t(M.footer)}</TransactionalFooter>
    </EmailLayout>
  )
}
