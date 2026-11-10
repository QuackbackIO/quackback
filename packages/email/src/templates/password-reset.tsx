import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'
import { BrandButton, BrandLink } from './brand-parts'

interface PasswordResetEmailProps {
  resetLink: string
  logoUrl?: string
  /** The workspace's name, for the preview line and the logo's alt text. */
  workspaceName?: string
}

/** "Reset your Acme password", or without a name when there is none. */
export const passwordResetSubject = (workspaceName?: string) =>
  workspaceName?.trim() ? `Reset your ${workspaceName.trim()} password` : 'Reset your password'

export function PasswordResetEmail({ resetLink, logoUrl, workspaceName }: PasswordResetEmailProps) {
  return (
    <EmailLayout
      preview={passwordResetSubject(workspaceName)}
      logoUrl={logoUrl}
      logoAlt={workspaceName?.trim() || undefined}
    >
      {/* Content */}
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>Reset your password</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Click the button below to set a new password. This link expires in 24 hours.
      </Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <BrandButton href={resetLink}>Reset Password</BrandButton>
      </Section>

      {/* Fallback Link */}
      <Text style={typography.textSmall}>
        Or copy and paste this link into your browser:{' '}
        <BrandLink href={resetLink}>{resetLink}</BrandLink>
      </Text>

      {/* Footer */}
      <TransactionalFooter>
        If you didn&apos;t request a password reset, you can safely ignore this email.
      </TransactionalFooter>
    </EmailLayout>
  )
}
