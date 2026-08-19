/**
 * Dry-run preview (support platform §4.6 dry-run preview): pick a
 * conversation, run the SAVED workflow against it read-only, and see the
 * ordered trace of what would happen — which condition/branch nodes matched
 * for real, and where the run would park or end. Nothing is written; see
 * workflow-preview.ts's previewWorkflow for the read-only guarantee.
 *
 * v1 conversation picker is a plain text field for a pasted conversation ID
 * (no lightweight conversation-search query exists yet to build a combobox
 * on) — a helper line points at where to find one (the inbox URL).
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  PauseCircleIcon,
} from '@heroicons/react/24/outline'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import {
  previewWorkflowFn,
  type WorkflowPreviewResult,
  type WorkflowPreviewTraceEntry,
} from '@/lib/server/functions/workflows'

const OUTCOME_META: Record<
  WorkflowPreviewTraceEntry['outcome'],
  { icon: typeof CheckCircleIcon; className: string }
> = {
  planned: { icon: CheckCircleIcon, className: 'text-emerald-600 dark:text-emerald-400' },
  parked: { icon: PauseCircleIcon, className: 'text-amber-600 dark:text-amber-500' },
  end: { icon: FlagIcon, className: 'text-muted-foreground' },
}

function TraceRow({ entry, index }: { entry: WorkflowPreviewTraceEntry; index: number }) {
  const meta = OUTCOME_META[entry.outcome]
  const Icon = meta.icon
  return (
    <div className="flex items-start gap-2.5 py-2 text-[13px]">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
        {index + 1}
      </span>
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{entry.summary}</div>
        <div className="text-xs text-muted-foreground">{entry.kind}</div>
      </div>
    </div>
  )
}

function FinalStatusNote({ result }: { result: WorkflowPreviewResult }) {
  if (result.finalStatus === 'waiting') {
    return <p className="text-xs text-muted-foreground">The run would pause here and wait.</p>
  }
  if (result.finalStatus === 'halted') {
    return (
      <p className="text-xs text-muted-foreground">
        The run would stop here — no condition/branch further along matched.
      </p>
    )
  }
  return <p className="text-xs text-muted-foreground">The run would complete.</p>
}

export function PreviewPanel({
  workflowId,
  open,
  onOpenChange,
  dirty,
}: {
  workflowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Disables Run preview while the builder has unsaved changes — the
   *  preview always runs the last SAVED graph, so a dirty draft would
   *  otherwise silently preview stale logic. */
  dirty: boolean
}) {
  const [conversationId, setConversationId] = useState('')

  const previewMutation = useMutation({
    mutationFn: () =>
      previewWorkflowFn({ data: { workflowId, conversationId: conversationId.trim() } }),
  })

  const result = previewMutation.data

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) previewMutation.reset()
        onOpenChange(next)
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Test this workflow</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Runs the last saved version against a real conversation — nothing is sent or recorded.
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <Label htmlFor="preview-conversation-id">Conversation ID</Label>
            <Input
              id="preview-conversation-id"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="conversation_01h..."
              disabled={dirty}
            />
            <p className="text-xs text-muted-foreground">
              Paste a conversation ID from its inbox URL (the <code>i=</code> query param).
            </p>
          </div>

          <div className="mt-3">
            <Button
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={dirty || !conversationId.trim() || previewMutation.isPending}
            >
              {previewMutation.isPending ? 'Running…' : 'Run preview'}
            </Button>
            {dirty && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Save first — the preview runs the saved workflow.
              </p>
            )}
          </div>

          {previewMutation.isError && (
            <div className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-[13px] text-destructive">
              <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {previewMutation.error instanceof Error
                  ? previewMutation.error.message
                  : 'Could not run the preview.'}
              </span>
            </div>
          )}

          {result && (
            <div className="mt-5">
              <div className="flex items-center gap-2">
                <span className={cn('shrink-0', MENU_LABEL)}>Audience</span>
                {result.audienceConfigured ? (
                  <Badge
                    size="sm"
                    shape="pill"
                    variant="outline"
                    className={
                      result.audienceMatched
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-500'
                    }
                  >
                    {result.audienceMatched ? 'Matches' : 'Does not match'}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">No audience configured</span>
                )}
              </div>

              <div className={cn('mt-4 mb-1', MENU_LABEL)}>Trace</div>
              {result.trace.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ClockIcon className="size-4 shrink-0" />
                  This workflow has no steps to walk.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {result.trace.map((entry, i) => (
                    <TraceRow key={`${entry.nodeId}-${i}`} entry={entry} index={i} />
                  ))}
                </div>
              )}
              <div className="mt-2">
                <FinalStatusNote result={result} />
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
