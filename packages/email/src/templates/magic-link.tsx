import { Button, Heading, Hr, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const MAGIC_LINK_MESSAGES = defineEmailMessages({
  subject: { id: 'email.magicLink.subject', defaultMessage: '{code} is your sign-in code' },
  subjectNamed: {
    id: 'email.magicLink.subjectNamed',
    defaultMessage: '{code} is your code for {workspace}',
  },
  preview: { id: 'email.magicLink.preview', defaultMessage: 'Your sign-in link' },
  heading: { id: 'email.magicLink.heading', defaultMessage: 'Sign in' },
  headingNamed: { id: 'email.magicLink.headingNamed', defaultMessage: 'Sign in to {workspace}' },
  body: {
    id: 'email.magicLink.body',
    defaultMessage: 'Click the button below to finish signing in.',
  },
  cta: { id: 'email.magicLink.cta', defaultMessage: 'Sign in' },
  codeIntro: {
    id: 'email.magicLink.codeIntro',
    defaultMessage: 'Or enter this code on the sign-in screen:',
  },
  expiry: {
    id: 'email.magicLink.expiry',
    defaultMessage: 'The link and code expire in 10 minutes.',
  },
  footer: {
    id: 'email.magicLink.footer',
    defaultMessage: "If you didn't request this, you can safely ignore this email.",
  },
})
const M = MAGIC_LINK_MESSAGES

interface MagicLinkEmailProps {
  signInUrl: string
  code: string
  logoUrl?: string
  /** The workspace being signed in to. */
  workspaceName?: string
  i18n?: EmailLocale
}

/**
 * Sign-in email containing both a one-click magic link and a 6-digit code.
 *
 * The link is the lower-friction path on desktop; the code is the
 * cross-device fallback (start on desktop, open email on phone — type
 * the code on the device that started the flow). Either consumes the
 * verification record on the server, so the user can pick whichever is
 * convenient.
 */
export function MagicLinkEmail({
  signInUrl,
  code,
  logoUrl,
  workspaceName,
  i18n = ENGLISH_EMAIL,
}: MagicLinkEmailProps) {
  const { t } = i18n
  const name = workspaceName?.trim()
  return (
    <EmailLayout preview={t(M.preview)} logoUrl={logoUrl} i18n={i18n}>
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>
        {name ? t(M.headingNamed, { workspace: name }) : t(M.heading)}
      </Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>{t(M.body)}</Text>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={signInUrl}>
          {t(M.cta)}
        </Button>
      </Section>

      <Hr style={{ margin: '32px 0', borderColor: '#e5e7eb' }} />

      <Text style={{ ...typography.text, textAlign: 'center' }}>{t(M.codeIntro)}</Text>

      <Section style={utils.codeBox}>
        <Text style={utils.code}>{code}</Text>
      </Section>

      <Text style={{ ...typography.textSmall, textAlign: 'center' }}>{t(M.expiry)}</Text>

      <TransactionalFooter>{t(M.footer)}</TransactionalFooter>
    </EmailLayout>
  )
}
