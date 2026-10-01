/**
 * Fullscreen builder top bar (support platform §4.6): back link, outline
 * toggle, an inline-renameable workflow name, status + class pills, the
 * issues chip (jumps to the first invalid step), the Visual/JSON toggle,
 * the dirty-state text, and the explicit Save / Set live / Pause actions.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ClockIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
  RectangleGroupIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import type { WorkflowClassValue, WorkflowStatusValue } from '../workflow-graph'
import { WORKFLOW_CLASSES } from '../workflow-graph'

const STATUS_STYLE: Record<WorkflowStatusValue, string> = {
  draft: 'bg-muted text-muted-foreground',
  live: 'bg-success/10 text-success',
  paused: 'bg-warning/10 text-warning',
}
const STATUS_DOT: Record<WorkflowStatusValue, string> = {
  draft: 'bg-muted-foreground',
  live: 'bg-success',
  paused: 'bg-warning',
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)

  const commit = () => {
    const next = text.trim()
    if (next) onChange(next)
    else setText(value)
  }

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
      aria-label="Workflow name"
      className="max-w-64 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-border focus:border-border focus:bg-muted/40 focus-visible:outline-none"
    />
  )
}

export function WorkflowBuilderTopBar({
  name,
  onChangeName,
  status,
  workflowClass,
  issuesCount,
  onJumpToFirstIssue,
  mode,
  onSetMode,
  dirty,
  saving,
  onSave,
  canGoLive,
  onSetLive,
  onPause,
  statusPending,
  outlineCollapsed,
  onToggleOutline,
  onOpenHistory,
}: {
  name: string
  onChangeName: (v: string) => void
  status: WorkflowStatusValue
  workflowClass: WorkflowClassValue
  issuesCount: number
  onJumpToFirstIssue: () => void
  mode: 'visual' | 'json'
  onSetMode: (mode: 'visual' | 'json') => void
  dirty: boolean
  saving: boolean
  onSave: () => void
  canGoLive: boolean
  onSetLive: () => void
  onPause: () => void
  statusPending: boolean
  outlineCollapsed: boolean
  onToggleOutline: () => void
  /** Opens the version history + rollback sheet (support platform §4.6). */
  onOpenHistory: () => void
}) {
  const classMeta = WORKFLOW_CLASSES.find((c) => c.value === workflowClass)

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border/50 px-3">
      <Button variant="ghost" size="icon" className="size-8" asChild>
        <Link to="/admin/settings/workflows" aria-label="Back to workflows">
          <ArrowLeftIcon className="size-4" />
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={onToggleOutline}
        aria-label={outlineCollapsed ? 'Show outline' : 'Hide outline'}
        aria-pressed={!outlineCollapsed}
      >
        <ViewColumnsIcon className="size-4" />
      </Button>
      <div className="h-5 w-px bg-border" />

      <span className="text-xs text-muted-foreground">Workflows /</span>
      <NameField value={name} onChange={onChangeName} />

      <span
        className={cn(
          'inline-flex h-5.5 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold',
          STATUS_STYLE[status]
        )}
      >
        <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
        {status === 'live' ? 'Live' : status === 'paused' ? 'Paused' : 'Draft'}
      </span>
      {classMeta && (
        <span className="hidden h-5.5 items-center rounded-full bg-primary/10 px-2.5 text-[11px] font-medium text-primary sm:inline-flex">
          {classMeta.label} · {classMeta.value === 'customer_facing' ? 'exclusive' : 'parallel'}
        </span>
      )}

      <div className="flex-1" />

      {issuesCount > 0 && (
        <button
          type="button"
          onClick={onJumpToFirstIssue}
          className="inline-flex h-5.5 items-center gap-1 rounded-full bg-warning/10 px-2.5 text-[11px] font-semibold text-warning hover:brightness-95"
        >
          <ExclamationTriangleIcon className="size-3" />
          {issuesCount} issue{issuesCount === 1 ? '' : 's'}
        </button>
      )}

      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        <button
          type="button"
          onClick={() => onSetMode('visual')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            mode === 'visual'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <RectangleGroupIcon className="size-3.5" /> Visual
        </button>
        <button
          type="button"
          onClick={() => onSetMode('json')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            mode === 'json'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <CodeBracketIcon className="size-3.5" /> JSON
        </button>
      </div>

      <Button size="sm" variant="outline" onClick={onOpenHistory}>
        <ClockIcon className="size-3.5" />
        History
      </Button>

      <span className="hidden text-xs text-muted-foreground sm:inline">
        {dirty ? 'Unsaved changes' : 'Saved'}
      </span>

      <div className="h-5 w-px bg-border" />

      <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty || saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>

      {status === 'live' ? (
        <Button size="sm" variant="outline" onClick={onPause} disabled={statusPending}>
          Pause
        </Button>
      ) : (
        <Button size="sm" onClick={onSetLive} disabled={statusPending || !canGoLive}>
          Set live
        </Button>
      )}
    </header>
  )
}
