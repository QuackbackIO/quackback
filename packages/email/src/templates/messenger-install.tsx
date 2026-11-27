import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const MESSENGER_INSTALL_MESSAGES = defineEmailMessages({
  subject: {
    id: 'email.messengerInstall.subject',
    defaultMessage: 'Add {workspace} Messenger to the website',
  },
  heading: { id: 'email.messengerInstall.heading', defaultMessage: 'Add Messenger to the website' },
  body: {
    id: 'email.messengerInstall.body',
    defaultMessage:
      "{name} asked you to put {workspace}'s Messenger on the website. Paste this code before the closing body tag on every page.",
  },
  tagManager: {
    id: 'email.messengerInstall.tagManager',
    defaultMessage:
      'Using Google Tag Manager? Create a Custom HTML tag with the same code and trigger it on All pages.',
  },
  footer: {
    id: 'email.messengerInstall.footer',
    defaultMessage: '{name} will see Messenger connect as soon as it loads on the site.',
  },
})

interface MessengerInstallEmailProps {
  senderName: string
  workspaceName: string
  snippet: string
  logoUrl?: string
  i18n?: EmailLocale
}

/** A teammate asks whoever edits the website to add Messenger. */
export function MessengerInstallEmail({
  senderName,
  workspaceName,
  snippet,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: MessengerInstallEmailProps) {
  const { t } = i18n
  return (
    <EmailLayout
      preview={t(MESSENGER_INSTALL_MESSAGES.subject, { workspace: workspaceName })}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
      i18n={i18n}
    >
      <Heading style={typography.h1}>{t(MESSENGER_INSTALL_MESSAGES.heading)}</Heading>
      <Text style={typography.text}>
        {t(MESSENGER_INSTALL_MESSAGES.body, { name: senderName, workspace: workspaceName })}
      </Text>
      <Section style={codeBlock}>
        <Text style={codeText}>{snippet}</Text>
      </Section>
      <Text style={typography.textSmall}>{t(MESSENGER_INSTALL_MESSAGES.tagManager)}</Text>
      <TransactionalFooter>
        {t(MESSENGER_INSTALL_MESSAGES.footer, { name: senderName })}
      </TransactionalFooter>
    </EmailLayout>
  )
}

const codeBlock = {
  backgroundColor: '#F4F4F5',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '16px 0',
}

const codeText = {
  color: colors.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '12px',
  lineHeight: '18px',
  whiteSpace: 'pre-wrap' as const,
  margin: '0',
}
