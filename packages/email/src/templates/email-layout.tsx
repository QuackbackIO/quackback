import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
  Link,
} from '@react-email/components'
import { layout, branding, typography, utils, colors, DEFAULT_LOGO_URL } from './shared-styles'

interface EmailLayoutProps {
  preview: string
  logoUrl?: string
  logoAlt?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * Shared email layout with proper HTML email best practices:
 * - Wrapper Section with background color (fallback for clients that strip <body> styles)
 * - Centered container via React Email's align="center" (no margin:auto)
 * - Consistent logo, spacing, and footer placement
 */
export function EmailLayout({
  preview,
  logoUrl,
  logoAlt = 'Quackback',
  children,
  footer,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={layout.main}>
        {/* Wrapper Section provides background color for clients that strip <body> styles */}
        <Section style={{ backgroundColor: colors.background }}>
          <Container style={layout.container}>
            {/* Logo */}
            <Section style={branding.logoContainer}>
              <Img
                src={logoUrl ?? DEFAULT_LOGO_URL}
                alt={logoAlt}
                width={branding.logo.width}
                height={branding.logo.height}
                style={branding.logo}
              />
            </Section>

            {children}

            {/* Footer */}
            {footer}
          </Container>
        </Section>
      </Body>
    </Html>
  )
}

/** Standard footer for transactional emails (sign-in, password reset, welcome, invitation) */
export function TransactionalFooter({ children }: { children: React.ReactNode }) {
  return <Text style={typography.footer}>{children}</Text>
}

/** Standard footer for notification emails with unsubscribe link */
export function NotificationFooter({
  reason,
  unsubscribeUrl,
  unsubscribeLabel = 'Unsubscribe from this post',
}: {
  reason: string
  unsubscribeUrl: string
  unsubscribeLabel?: string
}) {
  return (
    <Text style={typography.footer}>
      {reason}
      <br />
      <Link href={unsubscribeUrl} style={{ ...utils.link, fontSize: '13px' }}>
        {unsubscribeLabel}
      </Link>
    </Text>
  )
}
