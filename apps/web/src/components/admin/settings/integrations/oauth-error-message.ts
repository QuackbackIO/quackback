import type { IntlShape } from 'react-intl'

/**
 * Why a connection attempt came back as `?<integration>=error&reason=<code>`,
 * in words. The codes are the ones oauth-handlers.ts sends: the provider's own
 * refusal (`<integration>_denied`), an expired or tampered request, a session
 * that ended or changed mid-flow, missing app credentials, an account already
 * serving another workspace, or a failed token exchange.
 */
export function oauthErrorMessage(
  intl: IntlShape,
  reason: string | undefined,
  integration: string,
  displayName: string
): string {
  switch (reason) {
    case `${integration}_denied`:
      return intl.formatMessage(
        {
          id: 'admin.integrations.oauthError.denied',
          defaultMessage: 'The connection was declined on {name}. Connect again to allow access.',
        },
        { name: displayName }
      )
    case 'invalid_state':
    case 'state_expired':
    case 'state_mismatch':
    case 'invalid_request':
      return intl.formatMessage({
        id: 'admin.integrations.oauthError.expired',
        defaultMessage: 'The connection request expired or was not valid. Try connecting again.',
      })
    // auth_required also covers a failed session lookup, so the copy does not
    // claim the session changed.
    case 'auth_required':
    case 'session_mismatch':
      return intl.formatMessage({
        id: 'admin.integrations.oauthError.session',
        defaultMessage: "We couldn't confirm your sign-in. Sign in again, then connect.",
      })
    case 'credentials_not_configured':
      return intl.formatMessage(
        {
          id: 'admin.integrations.oauthError.credentials',
          defaultMessage: 'Add the {name} app credentials before connecting.',
        },
        { name: displayName }
      )
    case 'already_connected_elsewhere':
      return intl.formatMessage(
        {
          id: 'admin.integrations.oauthError.elsewhere',
          defaultMessage:
            'This {name} account is already connected to another Quackback workspace.',
        },
        { name: displayName }
      )
    // exchange_failed also covers our own save failing, and unknown codes land
    // here too, so the copy blames neither side.
    default:
      return intl.formatMessage(
        {
          id: 'admin.integrations.oauthError.failed',
          defaultMessage: "The connection to {name} didn't finish. Try connecting again.",
        },
        { name: displayName }
      )
  }
}
