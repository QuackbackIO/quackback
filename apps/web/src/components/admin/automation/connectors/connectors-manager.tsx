'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleStackIcon, PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { connectorsQuery } from '@/lib/client/queries/connectors'
import { useToggleConnectorEnabled } from '@/lib/client/mutations/connectors'
import { getConnectorHealth } from './connector-health'
import { ConnectorFormDialog } from './connector-form-dialog'
import { DeleteConnectorDialog } from './delete-connector-dialog'
import type { ConnectorMethod, DataConnector } from '@/lib/server/domains/connectors/connector.types'

const METHOD_VARIANT: Record<ConnectorMethod, 'secondary' | 'outline'> = {
  GET: 'secondary',
  POST: 'outline',
}

/**
 * Data connectors list (AI & Automation): each row shows its method, an
 * enabled toggle, and a health badge from the circuit breaker's
 * status/failureCount. Create/edit share one dialog (ConnectorFormDialog);
 * delete gets its own confirmation, mirroring the webhooks settings UI.
 */
export function ConnectorsManager() {
  const { data: connectors } = useQuery(connectorsQuery())
  const [editing, setEditing] = useState<DataConnector | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DataConnector | null>(null)
  const toggleEnabled = useToggleConnectorEnabled()

  const list = connectors ?? []

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={CircleStackIcon}
            title="No data connectors configured"
            description="Define an external API call the AI assistant can use to look up or update data in other systems."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <PlusIcon className="h-4 w-4 mr-1.5" />
                New connector
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {list.length} connector{list.length === 1 ? '' : 's'}
            </p>
            <Button size="sm" onClick={() => setEditing('new')}>
              <PlusIcon className="h-4 w-4 mr-1.5" />
              New connector
            </Button>
          </div>

          <div className="space-y-3">
            {list.map((connector) => {
              const health = getConnectorHealth(connector)
              return (
                <div
                  key={connector.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border/50 p-4"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CircleStackIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium truncate max-w-[200px] sm:max-w-[300px]">
                          {connector.name}
                        </p>
                        <Badge variant={METHOD_VARIANT[connector.method]}>{connector.method}</Badge>
                        <Badge variant={health.variant} title={health.title}>
                          {health.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {connector.description}
                      </p>
                      {connector.lastError && connector.failureCount > 0 && (
                        <p
                          className="text-xs text-destructive mt-1 truncate"
                          title={connector.lastError}
                        >
                          Error: {connector.lastError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={connector.enabled}
                      onCheckedChange={(checked) =>
                        toggleEnabled.mutate({ id: connector.id, enabled: checked })
                      }
                      aria-label={`Toggle ${connector.name} enabled`}
                    />
                    <div className="hidden sm:flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(connector)}
                        aria-label={`Edit connector ${connector.name}`}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleting(connector)}
                        aria-label={`Delete connector ${connector.name}`}
                        className="text-destructive hover:text-destructive"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="sm:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" aria-label="Connector actions">
                            <EllipsisVerticalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(connector)}>
                            <PencilIcon className="h-4 w-4 mr-2" />
                            Edit connector
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleting(connector)}
                            className="text-destructive focus:text-destructive"
                          >
                            <TrashIcon className="h-4 w-4 mr-2" />
                            Delete connector
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {editing && (
        <ConnectorFormDialog
          connector={editing === 'new' ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}

      {deleting && (
        <DeleteConnectorDialog
          connector={deleting}
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}
    </div>
  )
}
