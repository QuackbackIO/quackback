import { lazy, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCatalogEntry,
  type IntegrationCategory,
  type PlatformCredentialField,
} from '@/lib/server/integrations/types'
import { cn } from '@/lib/shared/utils'

const PlatformCredentialsDialog = lazy(() =>
  import('./platform-credentials-dialog').then((m) => ({ default: m.PlatformCredentialsDialog }))
)

/** Display order for categories */
const CATEGORY_ORDER: IntegrationCategory[] = [
  'notifications',
  'issue_tracking',
  'support_crm',
  'user_data',
  'automation',
]

interface IntegrationStatus {
  id: string
  status: 'active' | 'paused' | 'error'
}

interface IntegrationListProps {
  catalog: IntegrationCatalogEntry[]
  integrations: IntegrationStatus[]
}

interface SelectedIntegration {
  type: string
  name: string
  fields: PlatformCredentialField[]
}

export function IntegrationList({ catalog, integrations }: IntegrationListProps) {
  const [selectedIntegration, setSelectedIntegration] = useState<SelectedIntegration | null>(null)
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory | 'all'>('all')

  const getIntegrationStatus = (integrationId: string) => {
    return integrations.find((i) => i.id === integrationId)
  }

  // Count integrations per category (only populated ones)
  const categoryCounts = new Map<IntegrationCategory, number>()
  for (const entry of catalog) {
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1)
  }

  const populatedCategories = CATEGORY_ORDER.filter((cat) => categoryCounts.has(cat))

  const filteredCatalog =
    activeCategory === 'all' ? catalog : catalog.filter((e) => e.category === activeCategory)

  return (
    <div className="flex gap-6">
      {/* Vertical category menu */}
      <div className="hidden sm:block w-40 shrink-0">
        <nav className="space-y-0.5">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              activeCategory === 'all'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            All
            <span className="text-[10px] text-muted-foreground">{catalog.length}</span>
          </button>
          {populatedCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                activeCategory === cat
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {INTEGRATION_CATEGORIES[cat].label}
              <span className="text-[10px] text-muted-foreground">{categoryCounts.get(cat)}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Compact card grid */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 content-start">
        {filteredCatalog.map((entry) => {
          const status = getIntegrationStatus(entry.id)
          const isConnected = status?.status === 'active'
          const isPaused = status?.status === 'paused'
          const Icon = INTEGRATION_ICON_MAP[entry.id]

          const icon = (
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                entry.available
                  ? entry.iconBg
                  : !entry.configurable
                    ? 'bg-muted/60'
                    : entry.iconBg + ' opacity-60'
              )}
            >
              {Icon ? (
                <Icon className="h-4 w-4 text-white" />
              ) : (
                <span className="text-white font-semibold text-xs">{entry.name.charAt(0)}</span>
              )}
            </div>
          )

          const statusBadge = isConnected ? (
            <Badge
              variant="outline"
              className="border-green-500/30 text-green-600 text-[10px] px-1.5 py-0"
            >
              Enabled
            </Badge>
          ) : isPaused ? (
            <Badge
              variant="outline"
              className="border-yellow-500/30 text-yellow-600 text-[10px] px-1.5 py-0"
            >
              Paused
            </Badge>
          ) : !entry.available && !entry.configurable ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border/40"
            >
              Coming soon
            </Badge>
          ) : !entry.available && entry.configurable ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border/40"
            >
              Not configured
            </Badge>
          ) : null

          // Available (connected) integration — link to settings
          if (entry.available) {
            return (
              <Link
                key={entry.id}
                to={entry.settingsPath}
                className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-all hover:border-border hover:shadow-sm"
              >
                {icon}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{entry.name}</p>
                  <div className="mt-0.5">{statusBadge}</div>
                </div>
                <ChevronRightIcon className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
              </Link>
            )
          }

          // Not available but configurable — opens credentials dialog
          if (entry.configurable) {
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() =>
                  setSelectedIntegration({
                    type: entry.id,
                    name: entry.name,
                    fields: entry.platformCredentialFields ?? [],
                  })
                }
                className="group flex items-center gap-3 rounded-lg border border-dashed border-border/40 bg-muted/10 p-3 text-left transition-all hover:border-border/60"
              >
                {icon}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{entry.name}</p>
                  <div className="mt-0.5">{statusBadge}</div>
                </div>
                <Cog6ToothIcon className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" />
              </button>
            )
          }

          // Coming soon — plain div
          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-dashed border-border/30 bg-muted/10 p-3"
            >
              {icon}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">{entry.name}</p>
                <div className="mt-0.5">{statusBadge}</div>
              </div>
            </div>
          )
        })}
      </div>

      {selectedIntegration && (
        <PlatformCredentialsDialog
          integrationType={selectedIntegration.type}
          integrationName={selectedIntegration.name}
          fields={selectedIntegration.fields}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedIntegration(null)
          }}
        />
      )}
    </div>
  )
}
