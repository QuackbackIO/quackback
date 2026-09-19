/**
 * The publish review: what this candidate changes, what has been checked
 * against it, and the release history it would join (QUINN-PRODUCT P7).
 *
 * Renders nothing at all when release management is off, because none of it is
 * true then: the settings row is live and a save is the publication.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TimeAgo } from '@/components/ui/time-ago'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  usePublishAssistantRelease,
  useRollbackAssistantRelease,
  useRunAssistantReleaseCheck,
} from '@/lib/client/mutations/assistant'
import {
  RELEASE_CHECKS,
  RELEASE_READING_LABELS,
  RELEASE_USE_LABELS,
  readingForCheck,
  type ReleaseCheckKey,
} from '@/lib/shared/assistant/release'

/** One line saying what is waiting, or nothing when there is nothing to say. */
export function candidateNote(input: {
  draftMatchesLive: boolean
  publishable: boolean
}): string | null {
  if (input.draftMatchesLive) return null
  return input.publishable ? 'Ready to publish' : 'Checks outstanding'
}

function errorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'ASSISTANT_RELEASE_CANDIDATE_CONFLICT')
    return 'Quinn changed since you reviewed this. Reload and review the new candidate.'
  if (code === 'ASSISTANT_RELEASE_LIVE_CONFLICT')
    return 'The live release changed in another session. Reload and review it again.'
  if (code === 'ASSISTANT_RELEASE_CHECKS_INCOMPLETE')
    return 'Required checks have not passed for this candidate.'
  return 'That did not go through. Try again.'
}

export function QuinnReleaseReview() {
  const state = useQuery(assistantQueries.releaseState())
  const runCheck = useRunAssistantReleaseCheck()
  const publish = usePublishAssistantRelease()
  const rollback = useRollbackAssistantRelease()
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  if (state.isPending || state.isError || !state.data?.managementEnabled) return null
  const { draft, live, checks, gate, history, draftMatchesLive } = state.data
  if (!draft) return null

  const byKey = new Map(checks.map((check) => [check.key, check]))
  const waiting = candidateNote({ draftMatchesLive, publishable: gate.publishable })

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Candidate</h2>
          {waiting && <Badge variant="outline">{waiting}</Badge>}
        </div>
        {draftMatchesLive ? (
          <p className="text-xs text-muted-foreground">Nothing to publish.</p>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{(draft.scope?.uses ?? []).map((use) => RELEASE_USE_LABELS[use]).join(', ')}</p>
            <ul className="space-y-0.5">
              {(draft.scope?.changedPaths ?? []).map((path) => (
                <li key={path} className="font-mono">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="divide-y divide-border/50 border-y border-border/50">
          {RELEASE_CHECKS.map((check) => {
            const result = byKey.get(check.key)
            const reading = readingForCheck(draft.candidateHash, result)
            return (
              <li key={check.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{check.label}</span>
                {result?.summary && reading !== 'not_run' && reading !== 'stale' && (
                  <span className="text-xs text-muted-foreground">{result.summary}</span>
                )}
                <Badge variant={reading === 'passed' ? 'secondary' : 'outline'}>
                  {RELEASE_READING_LABELS[reading]}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runCheck.isPending}
                  onClick={() => {
                    setFailure(null)
                    runCheck.mutate({ checkKey: check.key as ReleaseCheckKey })
                  }}
                >
                  Run
                </Button>
              </li>
            )
          })}
        </ul>

        {!draftMatchesLive && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Release note"
              className="max-w-xs"
            />
            <Button
              size="sm"
              disabled={!gate.publishable || publish.isPending}
              onClick={async () => {
                setFailure(null)
                try {
                  await publish.mutateAsync({
                    expectedCandidateHash: draft.candidateHash,
                    note: note.trim() || undefined,
                  })
                  setNote('')
                } catch (error) {
                  setFailure(errorMessage(error))
                }
              }}
            >
              Publish
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium">Releases</h2>
        <ul className="divide-y divide-border/50">
          {history.map((release) => (
            <li key={release.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">Release {release.releaseNumber}</span>
              {release.id === live?.id && <Badge variant="secondary">Live</Badge>}
              {release.origin === 'rollback' && <Badge variant="outline">Rollback</Badge>}
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {release.note}
              </span>
              {release.publishedAt && (
                <span className="text-xs text-muted-foreground">
                  <TimeAgo date={release.publishedAt} />
                </span>
              )}
              {release.id !== live?.id && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rollback.isPending}
                  onClick={async () => {
                    setFailure(null)
                    try {
                      await rollback.mutateAsync({
                        releaseId: release.id,
                        expectedLiveReleaseId: live?.id ?? null,
                      })
                    } catch (error) {
                      setFailure(errorMessage(error))
                    }
                  }}
                >
                  Roll back
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Rollback changes what future turns use. It cannot recall a sent message or an action
          already taken.
        </p>
      </div>
    </section>
  )
}
