import { useState, useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useIntl, type IntlShape } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteIntegration } from '@/lib/client/mutations'

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
    case 'auth_required':
    case 'session_mismatch':
      return intl.formatMessage({
        id: 'admin.integrations.oauthError.session',
        defaultMessage: 'Your session changed while connecting. Sign in again, then connect.',
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
    default:
      return intl.formatMessage(
        {
          id: 'admin.integrations.oauthError.failed',
          defaultMessage: "{name} didn't finish the connection. Try connecting again.",
        },
        { name: displayName }
      )
  }
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
  const intl = useIntl()
  const search = useSearch({ strict: false })
  const deleteMutation = useDeleteIntegration()
  const [showSuccess, setShowSuccess] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  useEffect(() => {
    const searchParams = search as Record<string, string | undefined>
    const result = searchParams[searchParamKey]
    if (result !== 'connected' && result !== 'error') return

    // Shown once: a reload or a shared link must not repeat it.
    const url = new URL(window.location.href)
    url.searchParams.delete(searchParamKey)
    url.searchParams.delete('reason')
    window.history.replaceState({}, '', url.toString())

    if (result === 'error') {
      // A stable id keeps this one toast when the effect runs again before the
      // router sees the stripped URL (StrictMode, a re-render).
      toast.error(oauthErrorMessage(intl, searchParams.reason, searchParamKey, displayName), {
        id: `oauth-result-${searchParamKey}`,
      })
      return
    }
    setShowSuccess(true)
    const timer = setTimeout(() => setShowSuccess(false), 3000)
    return () => clearTimeout(timer)
  }, [search, searchParamKey, displayName, intl])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const url = await getConnectUrl()
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      toast.error(err instanceof Error ? err.message : "Couldn't start connection. Try again.")
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
