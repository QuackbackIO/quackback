import type { ReactNode } from 'react'
import { BackLink } from '@/components/ui/back-link'
import { Badge } from '@/components/ui/badge'
import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

interface IntegrationHeaderProps {
  catalog: IntegrationCatalogEntry
  status?: 'active' | 'paused' | 'pending' | null
  workspaceName?: string | null
  icon?: ReactNode
  actions?: ReactNode
}

export function IntegrationHeader({
  catalog,
  status,
  workspaceName,
  icon,
  actions,
}: IntegrationHeaderProps) {
  const isConnected = status === 'active'
  const isPaused = status === 'paused'

  return (
    <>
      <BackLink to="/admin/settings/integrations">Integrations</BackLink>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${catalog.iconBg}`}
          >
            {icon ?? <span className="text-white font-bold text-lg">{catalog.name.charAt(0)}</span>}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{catalog.name}</h1>
              {isConnected && (
                <Badge variant="outline" className="border-green-500/30 text-green-600">
                  Enabled
                </Badge>
              )}
              {isPaused && (
                <Badge variant="outline" className="border-yellow-500/30 text-yellow-600">
                  Paused
                </Badge>
              )}
              {!status && !catalog.available && catalog.configurable && (
                <Badge variant="outline" className="text-muted-foreground/60 border-border/40">
                  Not configured
                </Badge>
              )}
              {!status && !catalog.available && !catalog.configurable && (
                <Badge variant="outline" className="text-muted-foreground/60 border-border/40">
                  Coming soon
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{catalog.description}</p>
            {workspaceName && (
              <p className="mt-1 text-xs text-muted-foreground">
                Connected to <span className="font-medium">{workspaceName}</span>
              </p>
            )}
          </div>
        </div>

        {actions}
      </div>
    </>
  )
}
