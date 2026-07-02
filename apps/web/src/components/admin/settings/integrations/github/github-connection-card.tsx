'use client'

import { useState } from 'react'
import { FolderIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon, TrashIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/shared/utils'
import { useDeleteIntegration } from '@/lib/client/mutations'
import { GitHubConfig } from './github-config'
import { GitHubReconnectButton } from './github-connection-actions'

interface ConnectionData {
  id: string
  status: string
  label: string | null
  config: Record<string, unknown>
  lastError: string | null
  eventMappings: Array<{
    id: string
    eventType: string
    enabled: boolean
    filters: Record<string, unknown> | null
  }>
}

interface GitHubConnectionCardProps {
  connection: ConnectionData
}

export function GitHubConnectionCard({ connection }: GitHubConnectionCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const deleteMutation = useDeleteIntegration()

  const isActive = connection.status === 'active'
  const isPaused = connection.status === 'paused'
  const repoName = (connection.config.channelId as string) || connection.label || 'Unconfigured'
  const syncDirection = (connection.config.syncDirection as string) || 'outbound'

  const handleDisconnect = () => {
    deleteMutation.mutate({ id: connection.id })
    setDisconnectOpen(false)
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between px-4 py-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex flex-1 items-center gap-3 text-left hover:text-foreground/80 transition-colors"
            >
              <ChevronDownIcon
                className={cn(
                  'size-4 text-muted-foreground transition-transform duration-200',
                  isOpen && 'rotate-180'
                )}
              />
              <FolderIcon className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{repoName}</span>
                  {isActive && (
                    <Badge variant="outline" className="border-green-500/30 text-green-600 text-xs">
                      Active
                    </Badge>
                  )}
                  {isPaused && (
                    <Badge
                      variant="outline"
                      className="border-yellow-500/30 text-yellow-600 text-xs"
                    >
                      Paused
                    </Badge>
                  )}
                  {connection.lastError && (
                    <Badge
                      variant="outline"
                      className="border-red-500/30 text-red-600 text-xs"
                      title={connection.lastError}
                    >
                      Error
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground capitalize">{syncDirection} sync</p>
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <GitHubReconnectButton
              integrationId={connection.id}
              label="Reconnect"
              className="h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => setDisconnectOpen(true)}
              disabled={deleteMutation.isPending}
              aria-label="Disconnect GitHub repository"
            >
              {deleteMutation.isPending ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <TrashIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="border-t border-border/50 px-6 py-5">
            {connection.lastError && (
              <div className="mb-4 flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
                <p>{connection.lastError}</p>
                <GitHubReconnectButton
                  integrationId={connection.id}
                  label="Reconnect GitHub"
                  className="self-start sm:self-auto"
                />
              </div>
            )}
            <GitHubConfig
              integrationId={connection.id}
              initialConfig={connection.config}
              initialEventMappings={connection.eventMappings}
              enabled={isActive}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect repository"
        description={`This will remove the GitHub integration for ${repoName} and stop all syncing. You can reconnect at any time.`}
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={handleDisconnect}
      />
    </div>
  )
}
