'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { getSlackConnectUrl } from '../actions'

interface SlackConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function SlackConnectionActions({
  integrationId,
  isConnected,
}: SlackConnectionActionsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [showSuccess, setShowSuccess] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Show success message if redirected from OAuth
  useEffect(() => {
    const slackParam = searchParams.get('slack')
    if (slackParam === 'connected') {
      setShowSuccess(true)
      // Clear the URL param
      const url = new URL(window.location.href)
      url.searchParams.delete('slack')
      window.history.replaceState({}, '', url.toString())
      // Hide after 3 seconds
      setTimeout(() => setShowSuccess(false), 3000)
    }
  }, [searchParams])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const url = await getSlackConnectUrl()
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!integrationId) return
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        startTransition(() => {
          router.refresh()
        })
      }
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Success toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>Connected successfully!</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {!isConnected && (
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </Button>
        )}

        {isConnected && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={disconnecting}>
                {disconnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  'Disconnect'
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the Slack integration and stop all notifications. You can
                  reconnect at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDisconnect}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}
