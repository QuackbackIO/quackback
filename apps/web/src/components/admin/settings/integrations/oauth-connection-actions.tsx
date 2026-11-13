import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useIntl, type IntlShape } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { toastError } from '@/lib/client/error-notice'

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

/**
 * Reads the result the OAuth callback appends on its way back
 * (`?<integration>=connected` or `?<integration>=error&reason=<code>`),
 * shows it once, and strips it through the router. Stripping with
 * window.history would leave the params in the router's search state, and the
 * next navigation that spreads the previous search would put them back.
 *
 * Returns true for three seconds after a successful connection.
 */
export function useOAuthResult(searchParamKey: string, displayName: string): boolean {
  const intl = useIntl()
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  const [showSuccess, setShowSuccess] = useState(false)

  const result = search[searchParamKey]
  const reason = typeof search.reason === 'string' ? search.reason : undefined

  useEffect(() => {
    if (result !== 'connected' && result !== 'error') return

    void navigate({
      to: '.',
      search: (previous) => {
        const { [searchParamKey]: _result, reason: _reason, ...rest } = previous
        return rest
      },
      replace: true,
    })

    if (result === 'error') {
      // A stable id keeps one toast if the effect runs again before the
      // router applies the stripped search (StrictMode, a re-render).
      toast.error(oauthErrorMessage(intl, reason, searchParamKey, displayName), {
        id: `oauth-result-${searchParamKey}`,
      })
      return
    }
    setShowSuccess(true)
  }, [result, reason, searchParamKey, displayName, intl, navigate])

  // Separate from the effect above: stripping the params re-runs that effect,
  // and its cleanup would cancel this timer and leave the banner up.
  useEffect(() => {
    if (!showSuccess) return
    const timer = setTimeout(() => setShowSuccess(false), 3000)
    return () => clearTimeout(timer)
  }, [showSuccess])

  return showSuccess
}

interface OAuthConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  /** The search param key used for the OAuth callback (e.g. "github", "slack") */
  searchParamKey: string
  /** Server function that returns the OAuth connect URL */
  getConnectUrl: () => Promise<string>
  /** Display name for the disconnect dialog (e.g. "GitHub", "Slack") */
  displayName: string
  /** Description for the disconnect dialog */
  disconnectDescription: string
  /** Connect button label. Defaults to "Connect {displayName}". */
  connectLabel?: string
}

export function OAuthConnectionActions({
  integrationId,
  isConnected,
  searchParamKey,
  getConnectUrl,
  displayName,
  disconnectDescription,
  connectLabel = `Connect ${displayName}`,
}: OAuthConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const showSuccess = useOAuthResult(searchParamKey, displayName)
  const [connecting, setConnecting] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const url = await getConnectUrl()
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      toastError(err, "Couldn't start connection. Try again.")
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    if (!integrationId) return
    deleteMutation.mutate({ id: integrationId })
  }

  const disconnecting = deleteMutation.isPending

  return (
    <>
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircleIcon className="h-4 w-4" />
          <span>Connected successfully!</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {!isConnected && (
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              connectLabel
            )}
          </Button>
        )}

        {isConnected && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={disconnecting}
              onClick={() => setDisconnectDialogOpen(true)}
            >
              {disconnecting ? (
                <>
                  <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect'
              )}
            </Button>
            <ConfirmDialog
              open={disconnectDialogOpen}
              onOpenChange={setDisconnectDialogOpen}
              title={`Disconnect ${displayName}?`}
              description={disconnectDescription}
              confirmLabel="Disconnect"
              isPending={disconnecting}
              onConfirm={handleDisconnect}
            />
          </>
        )}
      </div>
    </>
  )
}
