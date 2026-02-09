import { useState, useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { getSalesforceConnectUrl } from '@/lib/server/integrations/salesforce/functions'

interface SalesforceConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function SalesforceConnectionActions({
  integrationId,
  isConnected,
}: SalesforceConnectionActionsProps) {
  const search = useSearch({ strict: false })
  const deleteMutation = useDeleteIntegration()
  const [showSuccess, setShowSuccess] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  useEffect(() => {
    const searchParams = search as { salesforce?: string }
    if (searchParams.salesforce !== 'connected') return

    setShowSuccess(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('salesforce')
    window.history.replaceState({}, '', url.toString())

    const timer = setTimeout(() => setShowSuccess(false), 3000)
    return () => clearTimeout(timer)
  }, [search])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const url = await getSalesforceConnectUrl()
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
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
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircleIcon className="h-4 w-4" />
          <span>Connected successfully!</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {!isConnected && (
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect'
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
              title="Disconnect Salesforce?"
              description="This will remove the Salesforce integration and stop all CRM data enrichment. You can reconnect at any time."
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
