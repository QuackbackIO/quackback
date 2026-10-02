import { lazy, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { StateBadge } from '@/components/shared/state-badge'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCatalogEntry,
  type IntegrationCategory,
  type PlatformCredentialField,
} from '@/lib/shared/integration-types'
import { canInstallIntegration } from '@/lib/shared/integration-connect'
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

  const statusBadge = (status: IntegrationStatus | undefined) => {
    if (status?.status === 'active') return <StateBadge state="connected" />
    if (status?.status === 'paused') return <StateBadge state="off" />
    if (status?.status === 'error') return <StateBadge state="error" />
    return null
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Categories" className="flex flex-wrap gap-1.5">
        {[
          { id: 'all' as const, label: 'All', count: catalog.length },
          ...populatedCategories.map((cat) => ({
            id: cat,
            label: INTEGRATION_CATEGORIES[cat].label,
            count: categoryCounts.get(cat) ?? 0,
          })),
        ].map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setActiveCategory(chip.id)}
            aria-pressed={activeCategory === chip.id}
            className={cn(
              'h-8 rounded-full border px-3 text-[13px] transition-colors',
              activeCategory === chip.id
                ? 'border-transparent bg-muted font-medium text-foreground'
                : 'border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            {chip.label}{' '}
            <span className="ml-0.5 tabular-nums text-muted-foreground">{chip.count}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredCatalog.map((entry) => {
          const status = getIntegrationStatus(entry.id)
          const Icon = INTEGRATION_ICON_MAP[entry.id]

          const icon = (
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                entry.iconBg
              )}
            >
              {Icon ? (
                <Icon className="h-4 w-4 text-white" />
              ) : (
                <span className="text-xs font-semibold text-white">{entry.name.charAt(0)}</span>
              )}
            </div>
          )

          const body = (
            <>
              {icon}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {entry.name}
              </span>
              {statusBadge(status)}
            </>
          )
          const TILE =
            'flex items-center gap-3 rounded-panel border border-border bg-transparent p-3 text-left transition-colors'
          const TILE_ACTIVE = 'hover:bg-accent'

          // Platform-managed or already configured: open the install/settings page
          if (canInstallIntegration(entry)) {
            return (
              <Link
                key={entry.id}
                to={entry.settingsPath}
                data-settings-tile=""
                className={cn(TILE, TILE_ACTIVE)}
              >
                {body}
              </Link>
            )
          }

          // Not available but configurable: opens the credentials dialog
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
                data-settings-tile=""
                className={cn(TILE, TILE_ACTIVE)}
              >
                {body}
              </button>
            )
          }

          // Not yet available: the same tile, not interactive
          return (
            <div key={entry.id} className={TILE}>
              {icon}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {entry.name}
              </span>
              <span className="text-xs text-muted-foreground">Coming soon</span>
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
