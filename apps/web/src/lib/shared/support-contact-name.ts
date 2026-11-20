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

/**
 * The name customers see on a support message when no teammate is shown: the
 * messenger's team name, else the workspace name. Null when neither is set.
 */
export function supportTeamName(
  messengerTeamName: string | null | undefined,
  workspaceName: string | null | undefined
): string | null {
  return trimmed(messengerTeamName) ?? trimmed(workspaceName)
}
