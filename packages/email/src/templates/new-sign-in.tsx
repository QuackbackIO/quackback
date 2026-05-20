import { Heading, Hr, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'

interface NewSignInEmailProps {
  workspaceName?: string
  occurredAt: string
  ipAddress?: string | null
  userAgent?: string | null
  logoUrl?: string
}

/**
 * "New device" sign-in notification — sent only on first-sight of a
 * (UA, /24 IP) combination for the recipient's account. The user is
 * already signed in by the time this lands; the alert is purely
 * informational with a recovery path if it wasn't them.
 */
export function NewSignInEmail({
  workspaceName,
  occurredAt,
  ipAddress,
  userAgent,
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
        {userAgent ? (
          <Text style={typography.text}>
            <strong>Device:</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />

      <Text style={typography.text}>
        If that was you, no action needed. If it wasn’t, change your password and revoke any other
        active sessions.
      </Text>

      <TransactionalFooter>
        You&apos;re receiving this because a new sign-in was detected on your account. These alerts
        are required and can&apos;t be disabled.
      </TransactionalFooter>
    </EmailLayout>
  )
}
