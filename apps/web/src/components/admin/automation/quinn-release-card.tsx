/**
 * How Quinn's settings go live, on the Deploy page (QUINN-PRODUCT P7).
 *
 * Off is the default and means what it always meant: a save is live. On means a
 * save becomes a candidate somebody reviews and publishes. The row states which
 * of the two this workspace is on and, when it is the second, what is live and
 * whether anything is waiting; the review itself lives on Test Quinn, because
 * that is where the evidence is.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useSetAssistantReleaseManagement } from '@/lib/client/mutations/assistant'
import { candidateNote } from './quinn-release-review'

export function QuinnReleaseCard() {
  const state = useQuery(assistantQueries.releaseState())
  const setManagement = useSetAssistantReleaseManagement()

  if (state.isPending || state.isError) return null
  const { managementEnabled, live, gate, draftMatchesLive } = state.data
  const waiting = managementEnabled
    ? candidateNote({ draftMatchesLive, publishable: gate.publishable })
    : null

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Review changes before they go live</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Off, a save takes effect immediately.
          </p>
        </div>
        <Switch
          checked={managementEnabled}
          disabled={setManagement.isPending}
          onCheckedChange={(checked) => setManagement.mutate({ enabled: checked })}
          aria-label="Review changes before they go live"
        />
      </div>
      {managementEnabled && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {live?.releaseNumber != null && (
            <Badge variant="secondary">Release {live.releaseNumber}</Badge>
          )}
          {waiting && <Badge variant="outline">{waiting}</Badge>}
          <Link to="/admin/automation/test" className="text-primary">
            Review and publish
          </Link>
        </div>
      )}
    </div>
  )
}
