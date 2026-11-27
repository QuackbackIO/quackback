import { Heading, Link, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const SENDING_DOMAIN_ATTENTION_MESSAGES = defineEmailMessages({
  title: {
    id: 'email.sendingDomainAttention.title',
    defaultMessage: 'Sending from {domain} needs attention',
  },
  ownership: {
    id: 'email.sendingDomainAttention.ownership',
    defaultMessage: 'The verification record',
  },
  dkim: { id: 'email.sendingDomainAttention.dkim', defaultMessage: 'The DKIM record' },
  mailFrom: {
    id: 'email.sendingDomainAttention.mailFrom',
    defaultMessage: 'The return path record',
  },
  providerStopped: {
    id: 'email.sendingDomainAttention.providerStopped',
    defaultMessage: 'The email provider stopped confirming {domain}.',
  },
  signingKey: {
    id: 'email.sendingDomainAttention.signingKey',
    defaultMessage: "The signing key for {domain} isn't working.",
  },
  proxied: {
    id: 'email.sendingDomainAttention.proxied',
    defaultMessage: '{purpose} ({type} {name}) is proxied. Turn off any proxy for it.',
  },
  truncated: {
    id: 'email.sendingDomainAttention.truncated',
    defaultMessage: '{purpose} ({type} {name}) was cut short by your DNS host.',
  },
  quoted: {
    id: 'email.sendingDomainAttention.quoted',
    defaultMessage: '{purpose} ({type} {name}) has quote marks saved in its value.',
  },
  differentSeen: {
    id: 'email.sendingDomainAttention.differentSeen',
    defaultMessage: '{purpose} ({type} {name}) has a different value: {seen}.',
  },
  different: {
    id: 'email.sendingDomainAttention.different',
    defaultMessage: '{purpose} ({type} {name}) has a different value.',
  },
  missing: {
    id: 'email.sendingDomainAttention.missing',
    defaultMessage: '{purpose} ({type} {name}) is missing.',
  },
  deadline: {
    id: 'email.sendingDomainAttention.deadline',
    defaultMessage: 'Add it back by {deadline} to keep sending from {domain}.',
  },
  untilFixed: {
    id: 'email.sendingDomainAttention.untilFixed',
    defaultMessage: "Until it's fixed, email from this domain comes from your default address.",
  },
  value: { id: 'email.sendingDomainAttention.value', defaultMessage: 'Value: {value}' },
  openSettings: {
    id: 'email.sendingDomainAttention.openSettings',
    defaultMessage: 'Open email settings',
  },
  seeRecords: {
    id: 'email.sendingDomainAttention.seeRecords',
    defaultMessage: 'to see the records and check again.',
  },
  footer: {
    id: 'email.sendingDomainAttention.footer',
    defaultMessage: "You're receiving this because you manage email settings.",
  },
  footerNamed: {
    id: 'email.sendingDomainAttention.footerNamed',
    defaultMessage: "You're receiving this because you manage email settings for {workspace}.",
  },
})

const M = SENDING_DOMAIN_ATTENTION_MESSAGES

/** The record whose check failed, as the settings page names it. */
export interface SendingDomainAttentionRecord {
  purpose: 'ownership' | 'dkim' | 'mail-from'
  type: string
  /** The full DNS name, e.g. `qb-bounce.acme.com`. */
  name: string
  state: 'missing' | 'mismatch' | 'proxied'
  /** What was found instead, for a mismatch. */
  seen?: string
  /** A value the DNS host cut short or saved with its quote marks. */
  reason?: 'truncated' | 'quoted'
  /** The value to publish, for a record the owner has to add back. */
  value?: string
}

/**
 * What is wrong: the first listed record that failed its check, or
 * `signing-key` when every listed record looks right (or the key signing the
 * mail is not one of them) and signing still fails.
 */
export type SendingDomainAttentionProblem = SendingDomainAttentionRecord | 'signing-key'

export interface SendingDomainAttentionEmailProps {
  domain: string
  /** What failed; absent when nothing more specific is known. */
  record?: SendingDomainAttentionProblem | null
  /**
   * When set, a warning: the domain still sends as itself, and stops on this
   * date (already formatted) unless the record is fixed.
   */
  deadline?: string | null
  settingsUrl?: string | null
  workspaceName?: string
  logoUrl?: string
  /** The reader's language; English without one. */
  i18n?: EmailLocale
}

const PURPOSE_LABEL = {
  ownership: M.ownership,
  dkim: M.dkim,
  'mail-from': M.mailFrom,
} as const satisfies Record<SendingDomainAttentionRecord['purpose'], unknown>

/** The sending domain email's subject and heading. */
export function sendingDomainAttentionTitle(
  domain: string,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(M.title, { domain })
}

/** One sentence naming the record and what is wrong with it. */
export function sendingDomainProblem(
  domain: string,
  record: SendingDomainAttentionProblem | null | undefined,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  const { t } = i18n
  if (!record) return t(M.providerStopped, { domain })
  if (record === 'signing-key') return t(M.signingKey, { domain })
  const named = { purpose: t(PURPOSE_LABEL[record.purpose]), type: record.type, name: record.name }
  if (record.state === 'proxied') return t(M.proxied, named)
  if (record.state === 'mismatch') {
    if (record.reason === 'truncated') return t(M.truncated, named)
    if (record.reason === 'quoted') return t(M.quoted, named)
    return record.seen ? t(M.differentSeen, { ...named, seen: record.seen }) : t(M.different, named)
  }
  return t(M.missing, named)
}

/** The sentence giving the date a record has to be fixed by. */
export function sendingDomainDeadline(
  domain: string,
  deadline: string,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(M.deadline, { deadline, domain })
}

/**
 * Sent to the people who manage the workspace's email settings when a verified sending domain
 * stops verifying, because from that moment its email leaves from the default
 * address instead of the domain; or, with a deadline, when its ownership record
 * goes missing and it will stop verifying on that date unless the record is
 * added back.
 */
export function SendingDomainAttentionEmail({
  domain,
  record,
  deadline,
  settingsUrl,
  workspaceName,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: SendingDomainAttentionEmailProps) {
  const { t } = i18n
  const title = sendingDomainAttentionTitle(domain, i18n)
  return (
    <EmailLayout preview={title} logoUrl={logoUrl} i18n={i18n}>
      <Heading style={typography.h1}>{title}</Heading>
      <Text style={typography.text}>{sendingDomainProblem(domain, record, i18n)}</Text>
      {record && record !== 'signing-key' && record.value ? (
        <Text style={typography.text}>{t(M.value, { value: record.value })}</Text>
      ) : null}
      <Text style={typography.text}>
        {deadline ? sendingDomainDeadline(domain, deadline, i18n) : t(M.untilFixed)}
      </Text>
      {settingsUrl ? (
        <Text style={typography.text}>
          <Link href={settingsUrl} style={utils.link}>
            {t(M.openSettings)}
          </Link>{' '}
          {t(M.seeRecords)}
        </Text>
      ) : null}
      <TransactionalFooter>
        {workspaceName ? t(M.footerNamed, { workspace: workspaceName }) : t(M.footer)}
      </TransactionalFooter>
    </EmailLayout>
  )
}
