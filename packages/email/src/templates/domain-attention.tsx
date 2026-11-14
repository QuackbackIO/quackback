import { Heading, Link, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'

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
}

/** The heading and subject. */
export function domainAttentionTitle(domain: string, lapsed: boolean): string {
  return lapsed ? `${domain} is no longer verified` : `${domain} needs attention`
}

/** What happened, in the words the bell and the email share. */
export function domainAttentionMessage(args: {
  domain: string
  recordName: string
  deadline?: string | null
  signInDomains?: readonly string[] | null
}): string {
  const { domain, recordName, deadline, signInDomains } = args
  const named = `The ownership record (TXT ${recordName})`
  if (!signInDomains) {
    return deadline
      ? `${named} is missing. Add it back by ${deadline} to keep ${domain} verified.`
      : `${named} is missing.`
  }
  const base = `${named} is still missing.`
  return signInDomains.length > 0
    ? `${base} Sign-in is no longer verified for ${signInDomains.join(', ')}.`
    : base
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
}: DomainAttentionEmailProps) {
  const title = domainAttentionTitle(domain, !!signInDomains)
  return (
    <EmailLayout preview={title} logoUrl={logoUrl}>
      <Heading style={typography.h1}>{title}</Heading>
      <Text style={typography.text}>
        {domainAttentionMessage({ domain, recordName: record.name, deadline, signInDomains })}
      </Text>
      <Text style={typography.text}>Value: {record.value}</Text>
      {settingsUrl ? (
        <Text style={typography.text}>
          <Link href={settingsUrl} style={utils.link}>
            Open domain settings
          </Link>{' '}
          to check again.
        </Text>
      ) : null}
      <TransactionalFooter>
        You&apos;re receiving this because you manage domains
        {workspaceName ? ` for ${workspaceName}` : ''}.
      </TransactionalFooter>
    </EmailLayout>
  )
}
