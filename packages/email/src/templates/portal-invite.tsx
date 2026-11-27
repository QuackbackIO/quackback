import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter, LAYOUT_MESSAGES } from './email-layout'
import { typography, button, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const PORTAL_INVITE_MESSAGES = defineEmailMessages({
  subject: {
    id: 'email.portalInvite.subject',
    defaultMessage: "You've been invited to {workspace}",
  },
  preview: {
    id: 'email.portalInvite.preview',
    defaultMessage: "You've been invited to access the {workspace} portal",
  },
  heading: { id: 'email.portalInvite.heading', defaultMessage: "You've been invited!" },
  body: {
    id: 'email.portalInvite.body',
    defaultMessage:
      "You've been invited to access the {workspace} portal. Click below to accept and sign in.",
  },
  cta: { id: 'email.portalInvite.cta', defaultMessage: 'Accept invitation' },
  footer: {
    id: 'email.portalInvite.footer',
    defaultMessage: "If you weren't expecting this invitation, you can ignore this email.",
  },
})
const M = PORTAL_INVITE_MESSAGES

interface PortalInviteEmailProps {
  workspaceName: string
  inviteLink: string
  logoUrl?: string
  personalMessage?: string
  i18n?: EmailLocale
}

export function PortalInviteEmail({
  workspaceName,
  inviteLink,
  logoUrl,
  personalMessage,
  i18n = ENGLISH_EMAIL,
}: PortalInviteEmailProps) {
  const { t } = i18n
  return (
    <EmailLayout
      preview={t(M.preview, { workspace: workspaceName })}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>{t(M.heading)}</Heading>
      <Text style={typography.text}>{t(M.body, { workspace: workspaceName })}</Text>

      {personalMessage && (
        <Section
          style={{
            backgroundColor: '#f6f8fa',
            borderLeft: '3px solid #d0d7de',
            padding: '12px 16px',
            marginTop: '24px',
            marginBottom: '8px',
            borderRadius: '4px',
          }}
        >
          <Text style={{ ...typography.textSmall, margin: 0, fontStyle: 'italic' }}>
            {personalMessage}
          </Text>
        </Section>
      )}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={inviteLink}>
          {t(M.cta)}
        </Button>
      </Section>

      {/* Fallback Link */}
      <Text style={typography.textSmall}>
        {t(LAYOUT_MESSAGES.linkFallback)}{' '}
        <Link href={inviteLink} style={utils.link}>
          {inviteLink}
        </Link>
      </Text>

      {/* Footer */}
      <TransactionalFooter>{t(M.footer)}</TransactionalFooter>
    </EmailLayout>
  )
}
