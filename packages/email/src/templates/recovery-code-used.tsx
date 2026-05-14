import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'

interface RecoveryCodeUsedEmailProps {
  workspaceName?: string
  ipAddress?: string | null
  userAgent?: string | null
  occurredAt: string
  logoUrl?: string
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
}: RecoveryCodeUsedEmailProps) {
  const workspaceLabel = workspaceName ? ` for ${workspaceName}` : ''
  return (
    <EmailLayout preview={`A recovery code was used to sign in${workspaceLabel}`} logoUrl={logoUrl}>
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>A recovery code was used</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Someone signed in to your account{workspaceLabel} using one of your saved recovery codes.
      </Text>

      <Section style={{ marginTop: '24px', marginBottom: '24px' }}>
        <Text style={typography.textSmall}>
          <strong>When:</strong> {occurredAt}
        </Text>
        {ipAddress ? (
          <Text style={typography.textSmall}>
            <strong>IP address:</strong> {ipAddress}
          </Text>
        ) : null}
        {userAgent ? (
          <Text style={typography.textSmall}>
            <strong>Device:</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Text style={typography.text}>
        If this was you, no action is needed. The code is now spent and can&apos;t be reused.
      </Text>
      <Text style={typography.text}>
        If this wasn&apos;t you, sign in and rotate your recovery codes immediately. The person who
        used the code now has an active session — revoke it from your security settings.
      </Text>

      <TransactionalFooter>
        You&apos;re receiving this because a recovery code on your account was just used. These
        alerts are required and can&apos;t be disabled.
      </TransactionalFooter>
    </EmailLayout>
  )
}
