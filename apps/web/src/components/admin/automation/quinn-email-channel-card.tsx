import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantEmailChannel } from '@/lib/client/mutations/assistant'

/**
 * The Deploy page's Email row (QUINN-PRODUCT P9).
 *
 * It reads the real state rather than describing one. Autonomous replies need
 * an inbound route to arrive on and Quinn set to answer customers at all, so
 * the row says which of those is missing and offers the switch only when
 * neither is.
 */
export function QuinnEmailChannelCard() {
  const channel = useQuery(assistantQueries.emailChannel())
  const update = useUpdateAssistantEmailChannel()
  const state = channel.data
  // Only once the state is known. A row that has not loaded yet must not tell
  // an operator to go and set something up.
  const blocked = !state
    ? null
    : !state.inboundConfigured
      ? 'Set up an inbound email address first.'
      : !state.respondsToCustomers
        ? 'Turn on Quinn for customer conversations first.'
        : null

  return (
    <section
      aria-labelledby="quinn-email-channel-heading"
      className="rounded-xl border border-border/50 bg-card p-4 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="max-w-xl">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="quinn-email-channel-heading" className="text-sm font-medium">
            Email
          </h3>
          <Badge variant={state?.enabled && !blocked ? 'default' : 'outline'} shape="pill">
            {channel.isError
              ? 'Unavailable'
              : channel.isPending
                ? 'Loading…'
                : blocked
                  ? 'Setup required'
                  : state?.enabled
                    ? 'On'
                    : 'Off'}
          </Badge>
        </div>
        {state && (
          <p className="mt-1 text-xs text-muted-foreground">
            {blocked ??
              'Quinn answers verified senders in their own thread. Team replies are unaffected.'}
          </p>
        )}
      </div>
      {state && !state.inboundConfigured ? (
        <Link to="/admin/settings/channels/email" className="text-sm font-medium text-primary">
          Email settings
        </Link>
      ) : state && !blocked ? (
        <Button
          type="button"
          variant={state.enabled ? 'outline' : 'default'}
          className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          disabled={update.isPending}
          onClick={() => update.mutate(!state.enabled)}
        >
          {state.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      ) : null}
      {update.isError && (
        <p role="alert" className="w-full text-xs text-destructive">
          That could not be changed. Try again.
        </p>
      )}
    </section>
  )
}
