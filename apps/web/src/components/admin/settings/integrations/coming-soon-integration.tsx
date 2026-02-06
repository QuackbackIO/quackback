import { IntegrationHeader } from './integration-header'
import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

interface ComingSoonIntegrationProps {
  catalog: IntegrationCatalogEntry
}

export function ComingSoonIntegration({ catalog }: ComingSoonIntegrationProps) {
  return (
    <div className="space-y-6">
      <IntegrationHeader catalog={catalog} />

      {catalog.capabilities.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-3">
            What this integration will do
          </h3>
          <ul className="space-y-2.5">
            {catalog.capabilities.map((cap) => (
              <li key={cap.label} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/40" />
                <div>
                  <span className="text-sm font-medium text-foreground">{cap.label}</span>
                  <p className="text-sm text-muted-foreground">{cap.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40">
          <span className="text-2xl font-bold text-muted-foreground/40">
            {catalog.name.charAt(0)}
          </span>
        </div>
        <h3 className="mt-4 font-medium text-muted-foreground">Not yet available</h3>
        <p className="mt-2 text-sm text-muted-foreground/60 max-w-sm mx-auto">
          This integration is on our roadmap. Check back later or let us know if you'd like to see
          it prioritized.
        </p>
      </div>
    </div>
  )
}
