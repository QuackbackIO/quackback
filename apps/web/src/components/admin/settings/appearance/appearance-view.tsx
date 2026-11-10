import { useState } from 'react'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { PortalDesignRevisionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { restorePortalDesignVersionFn } from '@/lib/server/functions/portal-design'
import { designChanges } from '@/lib/shared/design/diff'
import { HistoryDialog } from './history-dialog'

/**
 * Appearance: what visitors see now, what waits in the draft, and the way
 * into the builder, where the design is changed and published.
 */
export function AppearanceView() {
  const { data } = useSuspenseQuery(portalDesignQueries.editor())
  const versions = useQuery(portalDesignQueries.versions())
  const queryClient = useQueryClient()
  const [history, setHistory] = useState(false)
  const waiting = data.source === 'draft' ? designChanges(data.live, data.design).length : 0
  const latest = versions.data?.[0]

  const restore = async (revisionId: PortalDesignRevisionId) => {
    const outcome = await restorePortalDesignVersionFn({ data: { revisionId } })
    if (!outcome.ok) return { ok: false as const, message: outcome.message }
    await queryClient.invalidateQueries({ queryKey: portalDesignQueries.editor().queryKey })
    return { ok: true as const }
  }

  return (
    <SettingsCard
      title="Design"
      action={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
            Versions
          </Button>
          <Button size="sm" asChild>
            <a href="/design?path=%2F&from=appearance">Open the builder</a>
          </Button>
        </div>
      }
    >
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
        <dt className="text-muted-foreground">Live</dt>
        <dd>
          {data.published ? (
            <span>
              Version {data.published.number}
              {latest?.number === data.published.number && (
                <>
                  , published <TimeAgo date={latest.createdAt} />
                </>
              )}
            </span>
          ) : (
            <span>Nothing published yet</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Draft</dt>
        <dd>
          {waiting === 0
            ? 'No changes waiting'
            : `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting to publish`}
        </dd>
      </dl>
      <HistoryDialog
        open={history}
        onOpenChange={setHistory}
        currentNumber={data.published?.number ?? null}
        onRestore={restore}
      />
    </SettingsCard>
  )
}
