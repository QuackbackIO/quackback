import { Heading, Link, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const DOMAIN_ATTENTION_MESSAGES = defineEmailMessages({
  title: { id: 'email.domainAttention.title', defaultMessage: '{domain} needs attention' },
  titleLapsed: {
    id: 'email.domainAttention.titleLapsed',
    defaultMessage: '{domain} is no longer verified',
  },
  missingBy: {
    id: 'email.domainAttention.missingBy',
    defaultMessage:
      'The verification record (TXT {record}) is missing. Add it back by {deadline} to keep {domain} verified.',
  },
  missing: {
    id: 'email.domainAttention.missing',
    defaultMessage: 'The verification record (TXT {record}) is missing.',
  },
  stillMissing: {
    id: 'email.domainAttention.stillMissing',
    defaultMessage: 'The verification record (TXT {record}) is still missing.',
  },
  stillMissingSignIn: {
    id: 'email.domainAttention.stillMissingSignIn',
    defaultMessage:
      'The verification record (TXT {record}) is still missing. Sign-in is no longer verified for {domains}.',
  },
  value: { id: 'email.domainAttention.value', defaultMessage: 'Value: {value}' },
  openSettings: {
    id: 'email.domainAttention.openSettings',
    defaultMessage: 'Open domain settings',
  },
  checkAgain: { id: 'email.domainAttention.checkAgain', defaultMessage: 'to check again.' },
  footer: {
    id: 'email.domainAttention.footer',
    defaultMessage: "You're receiving this because you manage domains.",
  },
  footerNamed: {
    id: 'email.domainAttention.footerNamed',
    defaultMessage: "You're receiving this because you manage domains for {workspace}.",
  },
})

const M = DOMAIN_ATTENTION_MESSAGES

export interface DomainAttentionEmailProps {
  domain: string
  /** The ownership record to publish: its full name and exact value. */
  record: { name: string; value: string }
  /**
   * When set, a warning: the domain is still verified, and stops being on this
   * date (already formatted) unless the record is added back.
   */
  deadline?: string | null
  /**
   * Set once the domain stopped being verified: the sign-in domains that
   * stopped with it, possibly none.
   */
  signInDomains?: readonly string[] | null
  settingsUrl?: string | null
  workspaceName?: string
  logoUrl?: string
  /** The reader's language; English without one. */
  i18n?: EmailLocale
}

/** The heading and subject. */
export function domainAttentionTitle(
  domain: string,
  lapsed: boolean,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(lapsed ? M.titleLapsed : M.title, { domain })
}

/** What happened, in the words the bell and the email share. */
export function domainAttentionMessage(
  args: {
    domain: string
    recordName: string
    deadline?: string | null
    signInDomains?: readonly string[] | null
  },
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  const { domain, recordName: record, deadline, signInDomains } = args
  if (!signInDomains) {
    return deadline
      ? i18n.t(M.missingBy, { record, deadline, domain })
      : i18n.t(M.missing, { record })
  }
  return signInDomains.length > 0
    ? i18n.t(M.stillMissingSignIn, { record, domains: signInDomains.join(', ') })
    : i18n.t(M.stillMissing, { record })
}

/**
 * Sent to the people who manage the workspace's domains when a domain added
 * by name loses its ownership record: with a deadline while it is still
 * verified, and without one once it is not.
 */
export function DomainAttentionEmail({
  domain,
  record,
  deadline,
  signInDomains,
  settingsUrl,
  workspaceName,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: DomainAttentionEmailProps) {
  const { t } = i18n
  const title = domainAttentionTitle(domain, !!signInDomains, i18n)
  return (
    <EmailLayout preview={title} logoUrl={logoUrl} i18n={i18n}>
      <Heading style={typography.h1}>{title}</Heading>
      <Text style={typography.text}>
        {domainAttentionMessage({ domain, recordName: record.name, deadline, signInDomains }, i18n)}
      </Text>
      <Text style={typography.text}>{t(M.value, { value: record.value })}</Text>
      {settingsUrl ? (
        <Text style={typography.text}>
          <Link href={settingsUrl} style={utils.link}>
            {t(M.openSettings)}
          </Link>{' '}
          {t(M.checkAgain)}
        </Text>
      ) : null}
      <TransactionalFooter>
        {workspaceName ? t(M.footerNamed, { workspace: workspaceName }) : t(M.footer)}
      </TransactionalFooter>
    </EmailLayout>
  )
}
