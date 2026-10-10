/**
 * Name shown to agents for a support contact.
 *
 * The account name is who the person is. Posts and comments keep the public
 * display name, which stays generic for anonymous activity. This only chooses
 * a label; it never writes the public name.
 */

/** Better Auth's stock name when nobody collected a real one. */
const STOCK_ANONYMOUS_NAME = 'anonymous'

function trimmed(value: string | null | undefined): string | null {
  const name = value?.trim()
  return name ? name : null
}

export function supportContactName(input: {
  accountName?: string | null
  publicName?: string | null
  fallback: string
}): string {
  const accountName = trimmed(input.accountName)
  const publicName = trimmed(input.publicName)
  if (accountName && accountName.toLowerCase() !== STOCK_ANONYMOUS_NAME) return accountName
  if (publicName) return publicName
  if (accountName) return accountName
  return input.fallback
}
