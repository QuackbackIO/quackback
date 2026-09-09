import { Heading, Hr, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'

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
}

/**
 * "New device" sign-in notification — sent when an additional
 * (browser, OS) is seen for the recipient's account. IP and location
 * are shown as context; they are not the device identity. The user is
 * already signed in by the time this lands; the alert is purely
 * informational with a recovery path if it wasn't them.
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
}: NewSignInEmailProps) {
  return (
    <EmailLayout preview="A new sign-in was detected on your account" logoUrl={logoUrl}>
      <Heading style={typography.h1}>New sign-in to your account</Heading>
      <Text style={typography.text}>
        {workspaceName
          ? `Someone just signed in to your ${workspaceName} account on a device we haven't seen before.`
          : 'Someone just signed in to your account on a device we haven’t seen before.'}
      </Text>

      <Section style={utils.codeBox}>
        <Text style={typography.text}>
          <strong>When:</strong> {occurredAt}
        </Text>
        {ipAddress ? (
          <Text style={typography.text}>
            <strong>IP:</strong> {ipAddress}
          </Text>
        ) : null}
        {location ? (
          <Text style={typography.text}>
            <strong>Location:</strong> {location}
          </Text>
        ) : null}
        {userAgent ? (
          <Text style={typography.text}>
            <strong>Device:</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />

      <Text style={typography.text}>
        {ssoEnforced ? (
          'If that was you, no action needed. If it wasn’t, sign in through your organization’s identity provider and review or revoke sessions there.'
        ) : (
          <>
            If that was you, no action needed. If it wasn’t,{' '}
            {settingsUrl ? (
              <>
                <Link href={settingsUrl} style={utils.link}>
                  set or change your password
                </Link>{' '}
                from your profile settings — this signs out other sessions.
              </>
            ) : (
              'set or change your password from your profile settings — this signs out other sessions.'
            )}
          </>
        )}
      </Text>

      <TransactionalFooter>
        You&apos;re receiving this because a new sign-in was detected on your account. These alerts
        are required and can&apos;t be disabled.
      </TransactionalFooter>
    </EmailLayout>
  )
}
