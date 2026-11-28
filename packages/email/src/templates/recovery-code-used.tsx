import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const SECURITY_EMAIL_MESSAGES = defineEmailMessages({
  when: { id: 'email.security.when', defaultMessage: 'When:' },
  ip: { id: 'email.security.ip', defaultMessage: 'IP address:' },
  location: { id: 'email.security.location', defaultMessage: 'Location:' },
  device: { id: 'email.security.device', defaultMessage: 'Device:' },
  recoverySubject: {
    id: 'email.security.recoverySubject',
    defaultMessage: 'A recovery code was used to sign in',
  },
  recoverySubjectNamed: {
    id: 'email.security.recoverySubjectNamed',
    defaultMessage: 'A recovery code was used to sign in to {workspace}',
  },
  recoveryEmailSubject: {
    id: 'email.security.recoveryEmailSubject',
    defaultMessage: 'A recovery code on your account was just used',
  },
  recoveryHeading: {
    id: 'email.security.recoveryHeading',
    defaultMessage: 'A recovery code was used',
  },
  recoveryBody: {
    id: 'email.security.recoveryBody',
    defaultMessage: 'Someone signed in to your account using one of your saved recovery codes.',
  },
  recoveryBodyNamed: {
    id: 'email.security.recoveryBodyNamed',
    defaultMessage:
      'Someone signed in to your account for {workspace} using one of your saved recovery codes.',
  },
  recoveryYou: {
    id: 'email.security.recoveryYou',
    defaultMessage:
      "If this was you, no action is needed. The code is now spent and can't be reused.",
  },
  recoveryNotYou: {
    id: 'email.security.recoveryNotYou',
    defaultMessage:
      "If this wasn't you, sign in and rotate your recovery codes immediately. The person who used the code now has an active session. Revoke it from your security settings.",
  },
  recoveryFooter: {
    id: 'email.security.recoveryFooter',
    defaultMessage:
      "You're receiving this because a recovery code on your account was just used. These alerts are required and can't be disabled.",
  },
  signInSubject: {
    id: 'email.security.signInSubject',
    defaultMessage: 'New sign-in to your account',
  },
  signInPreview: {
    id: 'email.security.signInPreview',
    defaultMessage: 'A new sign-in was detected on your account',
  },
  signInHeading: {
    id: 'email.security.signInHeading',
    defaultMessage: 'New sign-in to your account',
  },
  signInBody: {
    id: 'email.security.signInBody',
    defaultMessage: "Someone just signed in to your account on a device we haven't seen before.",
  },
  signInBodyNamed: {
    id: 'email.security.signInBodyNamed',
    defaultMessage:
      "Someone just signed in to your {workspace} account on a device we haven't seen before.",
  },
  signInSso: {
    id: 'email.security.signInSso',
    defaultMessage:
      "If that was you, no action needed. If it wasn't, change your password at your identity provider and ask a workspace admin to sign out other sessions.",
  },
  signInPasswordIntro: {
    id: 'email.security.signInPasswordIntro',
    defaultMessage: "If that was you, no action needed. If it wasn't,",
  },
  signInPasswordLink: {
    id: 'email.security.signInPasswordLink',
    defaultMessage: 'set or change your password',
  },
  signInPasswordRest: {
    id: 'email.security.signInPasswordRest',
    defaultMessage: 'from your profile settings. This signs out other sessions.',
  },
  signInFooter: {
    id: 'email.security.signInFooter',
    defaultMessage:
      "You're receiving this because a new sign-in was detected on your account. These alerts are required and can't be disabled.",
  },
})
const M = SECURITY_EMAIL_MESSAGES

interface RecoveryCodeUsedEmailProps {
  workspaceName?: string
  ipAddress?: string | null
  userAgent?: string | null
  occurredAt: string
  logoUrl?: string
  i18n?: EmailLocale
}

/**
 * Security alert sent after a recovery code is consumed. Mirrors the
 * "new sign-in from unrecognised device" pattern most platforms send
 * — the recipient is the one whose code was used, so the email is
 * their canary against unauthorised access.
 */
export function RecoveryCodeUsedEmail({
  workspaceName,
  ipAddress,
  userAgent,
  occurredAt,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: RecoveryCodeUsedEmailProps) {
  const { t } = i18n
  const workspace = workspaceName
  return (
    <EmailLayout
      preview={workspace ? t(M.recoverySubjectNamed, { workspace }) : t(M.recoverySubject)}
      logoUrl={logoUrl}
      i18n={i18n}
    >
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>{t(M.recoveryHeading)}</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        {workspace ? t(M.recoveryBodyNamed, { workspace }) : t(M.recoveryBody)}
      </Text>

      <Section style={{ marginTop: '24px', marginBottom: '24px' }}>
        <Text style={typography.textSmall}>
          <strong>{t(M.when)}</strong> {occurredAt}
        </Text>
        {ipAddress ? (
          <Text style={typography.textSmall}>
            <strong>{t(M.ip)}</strong> {ipAddress}
          </Text>
        ) : null}
        {userAgent ? (
          <Text style={typography.textSmall}>
            <strong>{t(M.device)}</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Text style={typography.text}>{t(M.recoveryYou)}</Text>
      <Text style={typography.text}>{t(M.recoveryNotYou)}</Text>

      <TransactionalFooter>{t(M.recoveryFooter)}</TransactionalFooter>
    </EmailLayout>
  )
}
