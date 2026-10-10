import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button, utils } from './shared-styles'

/** The invitation's words in the team's language, written by the caller. */
export interface InvitationEmailCopy {
  lang: string
  dir: 'ltr' | 'rtl'
  preview: string
  heading: string
  body: string
  cta: string
  fallback: string
  footer: string
}

interface InvitationEmailProps {
  invitedByName: string
  inviteeName?: string
  organizationName: string
  inviteLink: string
  logoUrl?: string
  /** Localised copy. Without it the email reads in English. */
  copy?: InvitationEmailCopy
}

function englishCopy({
  invitedByName,
  inviteeName,
  organizationName,
}: Pick<InvitationEmailProps, 'invitedByName' | 'inviteeName' | 'organizationName'>) {
  const body = `${invitedByName} invited you to the ${organizationName} team.`
  return {
    lang: 'en',
    dir: 'ltr' as const,
    preview: body,
    heading: inviteeName
      ? `Hi ${inviteeName}, join ${organizationName}`
      : `Join ${organizationName}`,
    body,
    cta: 'Accept invitation',
    fallback: 'Or paste this link into your browser:',
    footer: 'Not expecting this? You can ignore this email.',
  }
}

export function InvitationEmail(props: InvitationEmailProps) {
  const { organizationName, inviteLink, logoUrl } = props
  const copy = props.copy ?? englishCopy(props)
  return (
    <EmailLayout
      preview={copy.preview}
      logoUrl={logoUrl}
      logoAlt={organizationName}
      lang={copy.lang}
      dir={copy.dir}
    >
      <Heading style={typography.h1}>{copy.heading}</Heading>
      <Text style={typography.text}>{copy.body}</Text>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={inviteLink}>
          {copy.cta}
        </Button>
      </Section>

      <Text style={typography.textSmall}>
        {copy.fallback}{' '}
        <Link href={inviteLink} style={{ ...utils.link, direction: 'ltr', unicodeBidi: 'isolate' }}>
          {inviteLink}
        </Link>
      </Text>

      <TransactionalFooter>{copy.footer}</TransactionalFooter>
    </EmailLayout>
  )
}
