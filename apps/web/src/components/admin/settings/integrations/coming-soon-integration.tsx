import { BackLink } from '@/components/ui/back-link'
import { Badge } from '@/components/ui/badge'

interface ComingSoonIntegrationProps {
  name: string
  description: string
  iconBg: string
}

export function ComingSoonIntegration({ name, description, iconBg }: ComingSoonIntegrationProps) {
  return (
    <div className="space-y-6">
      <BackLink to="/admin/settings/integrations">Integrations</BackLink>

      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
          <span className="text-white font-bold text-lg">{name.charAt(0)}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{name}</h1>
            <Badge variant="outline" className="text-muted-foreground/60 border-border/40">
              Coming soon
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40">
          <span className="text-2xl font-bold text-muted-foreground/40">{name.charAt(0)}</span>
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
