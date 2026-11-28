import { Heading, Hr, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'
import { ENGLISH_EMAIL, type EmailLocale } from '../i18n'
import { SECURITY_EMAIL_MESSAGES as M } from './recovery-code-used'

interface NewSignInEmailProps {
  workspaceName?: string
  occurredAt: string
  ipAddress?: string | null
  userAgent?: string | null
  location?: string | null
  settingsUrl?: string | null
  /** When true, skip the password CTA — the profile page hides PasswordForm. */
  ssoEnforced?: boolean
  logoUrl?: string
  i18n?: EmailLocale
}

/**
 * "New device" sign-in notification — sent when an additional signed
 * device cookie is seen for the recipient's account. Browser/OS, IP
 * and location are shown as context; they are not the device identity.
 * The user is already signed in by the time this lands; the alert is
 * purely informational with a recovery path if it wasn't them.
 */
export function NewSignInEmail({
  workspaceName,
  occurredAt,
  ipAddress,
  userAgent,
  location,
  settingsUrl,
  ssoEnforced,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: NewSignInEmailProps) {
  const { t } = i18n
  return (
    <EmailLayout preview={t(M.signInPreview)} logoUrl={logoUrl} i18n={i18n}>
      <Heading style={typography.h1}>{t(M.signInHeading)}</Heading>
      <Text style={typography.text}>
        {workspaceName ? t(M.signInBodyNamed, { workspace: workspaceName }) : t(M.signInBody)}
      </Text>

      <Section style={utils.codeBox}>
        <Text style={typography.text}>
          <strong>{t(M.when)}</strong> {occurredAt}
        </Text>
        {ipAddress ? (
          <Text style={typography.text}>
            <strong>{t(M.ip)}</strong> {ipAddress}
          </Text>
        ) : null}
        {location ? (
          <Text style={typography.text}>
            <strong>{t(M.location)}</strong> {location}
          </Text>
        ) : null}
        {userAgent ? (
          <Text style={typography.text}>
            <strong>{t(M.device)}</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />

      <Text style={typography.text}>
        {ssoEnforced ? (
          t(M.signInSso)
        ) : (
          <>
            {t(M.signInPasswordIntro)}{' '}
            {settingsUrl ? (
              <>
                <Link href={settingsUrl} style={utils.link}>
                  {t(M.signInPasswordLink)}
                </Link>{' '}
                {t(M.signInPasswordRest)}
              </>
            ) : (
              `${t(M.signInPasswordLink)} ${t(M.signInPasswordRest)}`
            )}
          </>
        )}
      </Text>

      <TransactionalFooter>{t(M.signInFooter)}</TransactionalFooter>
    </EmailLayout>
  )
}
