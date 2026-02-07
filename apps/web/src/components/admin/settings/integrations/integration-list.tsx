import { lazy, useState, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCatalogEntry,
  type IntegrationCategory,
  type PlatformCredentialField,
} from '@/lib/server/integrations/types'

const PlatformCredentialsDialog = lazy(() =>
  import('./platform-credentials-dialog').then((m) => ({ default: m.PlatformCredentialsDialog }))
)

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  )
}

// Icon components keyed by integration ID (React components can't be serialized through loader data)
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  slack: SlackIcon,
}

/** Display order for categories */
const CATEGORY_ORDER: IntegrationCategory[] = [
  'notifications',
  'issue_tracking',
  'support_crm',
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

  const getIntegrationStatus = (integrationId: string) => {
    return integrations.find((i) => i.id === integrationId)
  }

  // Group catalog entries by category
  const grouped = new Map<IntegrationCategory, IntegrationCatalogEntry[]>()
  for (const entry of catalog) {
    const list = grouped.get(entry.category) ?? []
    list.push(entry)
    grouped.set(entry.category, list)
  }

  return (
    <div className="space-y-8">
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((category) => {
        const categoryMeta = INTEGRATION_CATEGORIES[category]
        const entries = grouped.get(category)!

        return (
          <div key={category}>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-foreground">{categoryMeta.label}</h2>
              <p className="text-xs text-muted-foreground">{categoryMeta.description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {entries.map((entry) => {
                const status = getIntegrationStatus(entry.id)
                const isConnected = status?.status === 'active'
                const isPaused = status?.status === 'paused'
                const Icon = ICON_MAP[entry.id]

                // Not available + configurable = needs platform credentials
                if (!entry.available && entry.configurable) {
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
                      className="group relative rounded-xl border border-dashed border-border/40 bg-muted/10 p-5 text-left transition-all hover:border-border/60"
                    >
                      {/* Hover overlay */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Cog6ToothIcon className="h-4 w-4" />
                          Configure
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${entry.iconBg} opacity-60`}
                        >
                          {Icon ? (
                            <Icon className="h-5 w-5 text-white" />
                          ) : (
                            <span className="text-white font-semibold text-sm">
                              {entry.name.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-muted-foreground">{entry.name}</h3>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border/40"
                            >
                              Not configured
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground/60 line-clamp-2">
                            {entry.description}
                          </p>
                          {entry.capabilities.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {entry.capabilities.map((cap) => (
                                <span
                                  key={cap.label}
                                  className="inline-flex items-center rounded-md bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground/60"
                                >
                                  {cap.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                }

                // Not available + not configurable = truly coming soon
                if (!entry.available) {
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-dashed border-border/30 bg-muted/10 p-5"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60">
                          <span className="text-muted-foreground font-semibold text-sm">
                            {entry.name.charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-muted-foreground">{entry.name}</h3>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border/40"
                            >
                              Coming soon
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground/60 line-clamp-2">
                            {entry.description}
                          </p>
                          {entry.capabilities.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {entry.capabilities.map((cap) => (
                                <span
                                  key={cap.label}
                                  className="inline-flex items-center rounded-md bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground/60"
                                >
                                  {cap.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }

                // Available integration card
                return (
                  <Link
                    key={entry.id}
                    to={entry.settingsPath}
                    className="group rounded-xl border border-border/50 bg-card p-5 shadow-sm transition-all hover:border-border hover:shadow-md"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg ${entry.iconBg}`}
                      >
                        {Icon ? (
                          <Icon className="h-5 w-5 text-white" />
                        ) : (
                          <span className="text-white font-semibold text-sm">
                            {entry.name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-foreground">{entry.name}</h3>
                          {isConnected && (
                            <Badge
                              variant="outline"
                              className="border-green-500/30 text-green-600 text-xs"
                            >
                              Enabled
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
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {entry.description}
                        </p>
                        {entry.capabilities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {entry.capabilities.map((cap) => (
                              <span
                                key={cap.label}
                                className="inline-flex items-center rounded-md bg-primary/5 px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {cap.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ChevronRightIcon className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5" />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
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
