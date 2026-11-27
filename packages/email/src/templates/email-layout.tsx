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
import { useEmailShowPoweredBy } from '../powered-by'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

const M = defineEmailMessages({
  poweredBy: { id: 'email.layout.poweredBy', defaultMessage: 'Powered by Quackback' },
  reasonAuthor: {
    id: 'email.layout.reasonAuthor',
    defaultMessage: 'You received this email because you submitted this feedback.',
  },
  reasonFollower: {
    id: 'email.layout.reasonFollower',
    defaultMessage: 'You received this email because you follow this post.',
  },
  unsubscribePost: {
    id: 'email.layout.unsubscribePost',
    defaultMessage: 'Unsubscribe from this post',
  },
  preferences: {
    id: 'email.layout.preferences',
    defaultMessage: 'Manage notification preferences',
  },
  linkFallback: {
    id: 'email.layout.linkFallback',
    defaultMessage: 'Or copy and paste this link into your browser:',
  },
})

/** The shared footer words, for templates that build their own. */
export const LAYOUT_MESSAGES = M

interface EmailLayoutProps {
  preview: string
  logoUrl?: string
  logoAlt?: string
  children: React.ReactNode
  footer?: React.ReactNode
  /**
   * Override the process-wide Powered-by flag. Capability-free templates
   * (no link, no code, no token) pass false so the footer cannot add an anchor.
   */
  showPoweredBy?: boolean
  /** Language of the email's copy (BCP-47), for screen readers and mail clients. */
  lang?: string
  /** Text direction of the copy; `rtl` lays the email out right to left. */
  dir?: 'ltr' | 'rtl'
  /** The email's locale: its language and direction, and the footer's words. */
  i18n?: EmailLocale
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
  showPoweredBy: showPoweredByOverride,
  lang: langProp,
  dir: dirProp,
  i18n,
}: EmailLayoutProps) {
  const lang = langProp ?? i18n?.lang
  const dir = dirProp ?? i18n?.dir
  const fromContext = useEmailShowPoweredBy()
  const showPoweredBy = showPoweredByOverride ?? fromContext
  return (
    <Html lang={lang ?? 'en'} dir={dir ?? 'ltr'}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={layout.main}>
        {/* Wrapper Section provides background color for clients that strip <body> styles */}
        <Section style={{ backgroundColor: colors.background }}>
          {/* dir again here: some clients drop the <html> attributes. */}
          <Container style={layout.container} dir={dir}>
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
            {showPoweredBy ? (
              <Text style={typography.footer}>
                <Link href="https://quackback.io" style={{ ...utils.link, fontSize: '13px' }}>
                  {(i18n ?? ENGLISH_EMAIL).t(M.poweredBy)}
                </Link>
              </Text>
            ) : null}
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

/** Why a post's status or comment email reached this reader: they wrote the post, or follow it. */
export function feedbackFooterReason(
  isPostAuthor: boolean,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(isPostAuthor ? M.reasonAuthor : M.reasonFollower)
}

/** Standard footer for notification emails with unsubscribe link */
export function NotificationFooter({
  reason,
  unsubscribeUrl,
  unsubscribeLabel,
  preferencesUrl,
  i18n = ENGLISH_EMAIL,
}: {
  reason: string
  unsubscribeUrl: string
  unsubscribeLabel?: string
  preferencesUrl?: string
  i18n?: EmailLocale
}) {
  return (
    <Text style={typography.footer}>
      {reason}
      <br />
      <Link href={unsubscribeUrl} style={{ ...utils.link, fontSize: '13px' }}>
        {unsubscribeLabel ?? i18n.t(M.unsubscribePost)}
      </Link>
      {preferencesUrl ? (
        <>
          {' · '}
          <Link href={preferencesUrl} style={{ ...utils.link, fontSize: '13px' }}>
            {i18n.t(M.preferences)}
          </Link>
        </>
      ) : null}
    </Text>
  )
}
