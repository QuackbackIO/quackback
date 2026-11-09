/**
 * The display name on mail that leaves from the platform address.
 *
 * The platform default From comes from the hosting registry (or `EMAIL_FROM`),
 * and its display name names the platform, not the workspace. Mail a workspace's
 * own customers and staff receive is about that workspace, so it goes under the
 * workspace's name even when the address is the platform's: account and security
 * mail always uses the platform address, so that it still arrives when the
 * workspace's own domain stops verifying, and only the name is the workspace's.
 *
 * Mail about the product itself (setting a workspace up, a sending domain that
 * needs fixing) is named for the product instead.
 *
 * Decided once, here, and applied at the shared send point, so a sender cannot
 * forget it: a sender only has to pass the workspace name it already has.
 */

/** The product's own name, on mail that is about the product. */
export const QUACKBACK_DISPLAY_NAME = 'Quackback'

/** Email types that speak for the product rather than for a workspace. */
const ABOUT_QUACKBACK_EMAIL_TYPES: ReadonlySet<string> = new Set([
  'OnboardingWelcomeEmail',
  'OnboardingNudgeEmail',
  'SendingDomainAttentionEmail',
])

/**
 * Email types written as a person on the team, whose name the caller passes
 * (an agent's reply). That name is the point of the email, so it is used even
 * where the operator's own name is kept for everything else.
 */
const PERSONAL_EMAIL_TYPES: ReadonlySet<string> = new Set([
  'ConversationReplyEmail',
  'ConversationMessageEmail',
])

/**
 * The name for a platform-address send of `emailType`.
 *
 * `undefined` means the configured From goes out as written. That is the case
 * when there is no workspace name to use, and when the From is the operator's
 * own `EMAIL_FROM` with a display name of its own (`operatorNamed`): an operator
 * who named their From chose what their recipients see, so only a person's name
 * on a reply replaces it.
 */
export function platformDisplayName(
  emailType: string,
  workspaceName: string | null | undefined,
  options: { operatorNamed?: boolean; callerName?: string } = {}
): string | undefined {
  if (options.operatorNamed) {
    const personal = options.callerName?.trim()
    return PERSONAL_EMAIL_TYPES.has(emailType) && personal ? personal : undefined
  }
  if (ABOUT_QUACKBACK_EMAIL_TYPES.has(emailType)) return QUACKBACK_DISPLAY_NAME
  const name = (options.callerName ?? workspaceName)?.trim()
  return name ? name : undefined
}
