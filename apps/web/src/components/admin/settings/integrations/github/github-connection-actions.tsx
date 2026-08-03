import { useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getGitHubConnectUrl } from '@/lib/server/integrations/github/functions'

interface GitHubReconnectButtonProps {
  integrationId: string
  label?: string
  className?: string
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
}

interface GitHubConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function GitHubReconnectButton({
  integrationId,
  label = 'Reconnect',
  className,
  variant = 'outline',
  size = 'sm',
}: GitHubReconnectButtonProps) {
  const [reconnecting, setReconnecting] = useState(false)

  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      const url = await getGitHubConnectUrl({
        data: { intent: 'reconnect', integrationId },
      })
      window.location.href = url
    } catch (err) {
      console.error('Failed to get reconnect URL:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to reconnect GitHub')
      setReconnecting(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleReconnect}
      disabled={reconnecting}
      aria-label="Reconnect GitHub"
    >
      {reconnecting ? (
        <>
          <ArrowPathIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Reconnecting...
        </>
      ) : (
        <>
          <ArrowPathIcon className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </>
      )}
    </Button>
  )
}

export function GitHubConnectionActions({
  integrationId,
  isConnected,
}: GitHubConnectionActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {isConnected && integrationId && <GitHubReconnectButton integrationId={integrationId} />}
      <OAuthConnectionActions
        integrationId={integrationId}
        isConnected={isConnected}
        searchParamKey="github"
        getConnectUrl={() => getGitHubConnectUrl({ data: { intent: 'new' } })}
        displayName="GitHub"
        disconnectDescription="This will remove the GitHub integration and stop all issue syncing. You can reconnect at any time."
      />
    </div>
  )
}
