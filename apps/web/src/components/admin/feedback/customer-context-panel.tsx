/**
 * Customer-context panel (IF WO-9). Renders normalized enrichment cards from
 * connected CRM integrations (Zendesk/HubSpot/Intercom) for a post's author.
 * Fetched ON DEMAND (only when an author email exists and the query is
 * enabled) — never eagerly per post row. Renders nothing when there's no
 * email or no connected provider returns a match.
 */
import { useQuery } from '@tanstack/react-query'
import {
  fetchCustomerContextFn,
  type EnrichmentCard,
} from '@/lib/server/functions/customer-context'
import { getIntegrationIcon } from '@/components/admin/settings/integrations/integration-ui'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid'

interface CustomerContextPanelProps {
  /** Real author email (already sanitized — synthetic anon emails are null). */
  email: string | null | undefined
}

export function CustomerContextPanel({ email }: CustomerContextPanelProps) {
  const { data: cards = [] } = useQuery({
    queryKey: ['customer-context', email],
    queryFn: () => fetchCustomerContextFn({ data: { email: email! } }),
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
  })

  if (!email || cards.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Customer context
      </h3>
      <div className="space-y-2">
        {cards.map((card) => (
          <ContextCard key={card.provider} card={card} />
        ))}
      </div>
    </div>
  )
}

function ContextCard({ card }: { card: EnrichmentCard }) {
  const Icon = getIntegrationIcon(card.provider)
  return (
    <div className="rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            {card.name && <div className="truncate text-sm font-medium">{card.name}</div>}
            {card.company && (
              <div className="truncate text-xs text-muted-foreground">{card.company}</div>
            )}
          </div>
        </div>
        {card.url && (
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Open in tool"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </a>
        )}
      </div>
      {card.fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {card.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="truncate text-right font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
