import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors, utils } from './shared-styles'

/**
 * The setup emails' content, already written in the recipient's language by
 * the caller. The template only lays it out, so every language reads the same.
 */
export interface OnboardingEmailContent {
  /** BCP-47 language of the copy, e.g. "de" or "pt-BR". */
  lang: string
  dir: 'ltr' | 'rtl'
  preview: string
  heading: string
  paragraphs: string[]
  /** The public link to share, shown on its own so it can be copied. */
  share?: { label: string; url: string; text: string } | null
  cta: { label: string; url: string }
  /** A quieter second action under the button. */
  secondary?: { lead: string; label: string; url: string } | null
  footer: { reason: string; unsubscribeLabel: string }
}

export interface OnboardingEmailProps extends OnboardingEmailContent {
  workspaceName: string
  unsubscribeUrl: string
  logoUrl?: string
}

/** The ready email and the day-two nudge: one short message, one action. */
export function OnboardingEmail({
  lang,
  dir,
  preview,
  heading,
  paragraphs,
  share,
  cta,
  secondary,
  footer,
  workspaceName,
  unsubscribeUrl,
  logoUrl,
}: OnboardingEmailProps) {
  return (
    <EmailLayout preview={preview} logoUrl={logoUrl} logoAlt={workspaceName} lang={lang} dir={dir}>
      <Heading style={typography.h1}>{heading}</Heading>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} style={typography.text}>
          {paragraph}
        </Text>
      ))}
      {share ? (
        <Section style={shareBox}>
          <Text style={shareLabel}>{share.label}</Text>
          <Text style={shareLink}>
            <Link href={share.url} style={utils.link}>
              {share.text}
            </Link>
          </Text>
        </Section>
      ) : null}
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button style={button.primary} href={cta.url}>
          {cta.label}
        </Button>
      </Section>
      {secondary ? (
        <Text style={typography.textSmall}>
          {secondary.lead}{' '}
          <Link href={secondary.url} style={utils.link}>
            {secondary.label}
          </Link>
        </Text>
      ) : null}
      <NotificationFooter
        reason={footer.reason}
        unsubscribeUrl={unsubscribeUrl}
        unsubscribeLabel={footer.unsubscribeLabel}
      />
    </EmailLayout>
  )
}

const shareBox = {
  backgroundColor: colors.background,
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '8px 0 0',
}

const shareLabel = {
  color: colors.textMuted,
  fontSize: '13px',
  lineHeight: '18px',
  margin: '0 0 4px',
}

const shareLink = {
  fontSize: '15px',
  fontWeight: '600' as const,
  lineHeight: '22px',
  margin: '0',
  // A URL reads left to right in every language.
  direction: 'ltr' as const,
  unicodeBidi: 'isolate' as const,
}
