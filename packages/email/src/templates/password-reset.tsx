import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter, LAYOUT_MESSAGES } from './email-layout'
import { typography, button, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const PASSWORD_RESET_MESSAGES = defineEmailMessages({
  subject: { id: 'email.passwordReset.subject', defaultMessage: 'Reset your password' },
  subjectNamed: {
    id: 'email.passwordReset.subjectNamed',
    defaultMessage: 'Reset your {workspace} password',
  },
  heading: { id: 'email.passwordReset.heading', defaultMessage: 'Reset your password' },
  body: {
    id: 'email.passwordReset.body',
    defaultMessage: 'Click the button below to set a new password. This link expires in 24 hours.',
  },
  cta: { id: 'email.passwordReset.cta', defaultMessage: 'Reset password' },
  footer: {
    id: 'email.passwordReset.footer',
    defaultMessage: "If you didn't request a password reset, you can safely ignore this email.",
  },
})
const M = PASSWORD_RESET_MESSAGES

interface PasswordResetEmailProps {
  resetLink: string
  logoUrl?: string
  /** Names the account's workspace in the inbox preview; Quackback without one. */
  workspaceName?: string
  i18n?: EmailLocale
}

export function PasswordResetEmail({
  resetLink,
  logoUrl,
  workspaceName,
  i18n = ENGLISH_EMAIL,
}: PasswordResetEmailProps) {
  const { t } = i18n
  return (
    <EmailLayout
      preview={t(M.subjectNamed, { workspace: workspaceName?.trim() || 'Quackback' })}
      logoUrl={logoUrl}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>{t(M.heading)}</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>{t(M.body)}</Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={resetLink}>
          {t(M.cta)}
        </Button>
      </Section>

      {/* Fallback Link */}
      <Text style={typography.textSmall}>
        {t(LAYOUT_MESSAGES.linkFallback)}{' '}
        <Link href={resetLink} style={utils.link}>
          {resetLink}
        </Link>
      </Text>

      {/* Footer */}
      <TransactionalFooter>{t(M.footer)}</TransactionalFooter>
    </EmailLayout>
  )
}
