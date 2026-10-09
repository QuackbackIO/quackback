import type { IntlShape } from 'react-intl'

/**
 * Messenger's greeting until the team writes its own. Stored workspaces may
 * hold this exact text, so it doubles as the marker of an unchanged greeting.
 */
export const DEFAULT_WELCOME_MESSAGE = 'Hi! 👋 How can we help you today?'

/**
 * The greeting a visitor sees: the default one in their language, or the
 * team's own words untouched.
 */
export function shownGreeting(welcomeMessage: string | null, intl: IntlShape): string | null {
  if (welcomeMessage?.trim() !== DEFAULT_WELCOME_MESSAGE) return welcomeMessage
  return intl.formatMessage({
    id: 'widget.messenger.defaultGreeting',
    defaultMessage: 'Hi! 👋 How can we help you today?',
  })
}
