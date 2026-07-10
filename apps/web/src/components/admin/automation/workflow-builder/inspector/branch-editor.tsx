/**
 * The branch step editor: a reorderable path list (first matching path runs,
 * top to bottom), each row expanding in place to rename the path and edit its
 * condition — the inline equivalent of the old per-path popover. "Add path"
 * appends a fresh no-condition path; removing a path with nested steps asks
 * for confirmation first.
 */
import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWorkflowEntities } from '../entities'
import { ConditionEditor } from './condition-editor'
import { Field, movePathAdjacent, usePathRemovalConfirm } from './shared'
import {
  PATH_LETTERS,
  conditionSummary,
  type BranchPath,
  type TreeStep,
} from '../../workflow-graph'

export function BranchEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'branch' }>
  onChange: (step: TreeStep) => void
}) {
  const { labels } = useWorkflowEntities()
  const [expanded, setExpanded] = useState<number | null>(null)

  const updatePath = (i: number, path: BranchPath) =>
    onChange({ ...step, paths: step.paths.map((p, j) => (j === i ? path : p)) })
  const removePath = (key: string) => {
    onChange({ ...step, paths: step.paths.filter((p) => p.key !== key) })
    setExpanded(null)
  }
  // Branch paths have no separate `label` — the path's own `key` doubles as
  // its display name (see PathNameField below), so the confirm dialog names
  // itself off `key` rather than a `label` field BranchPath doesn't carry.
  const { requestRemove, confirmDialog } = usePathRemovalConfirm(
    step.paths,
    removePath,
    (p) => p.key
  )
  const movePath = (i: number, dir: -1 | 1) => {
    const next = movePathAdjacent(step.paths, i, dir)
    if (next === step.paths) return
    onChange({ ...step, paths: next })
    setExpanded(i + dir)
  }
  const addPath = () => {
    const used = new Set(step.paths.map((p) => p.key))
    let n = step.paths.length + 1
    while (used.has(`Path ${n}`)) n++
    onChange({ ...step, paths: [...step.paths, { key: `Path ${n}`, condition: {}, steps: [] }] })
  }

  return (
    <div className="space-y-3">
      <Field label="Paths">
        <div className="space-y-2">
          {step.paths.map((path, i) => {
            const letter = PATH_LETTERS[i] ?? String(i + 1)
            return (
              <div key={path.key} className="rounded-md border">
                <div className="flex items-center gap-1.5 p-1.5">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label="Move path up"
                      disabled={i === 0}
                      onClick={() => movePath(i, -1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUpIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move path down"
                      disabled={i === step.paths.length - 1}
                      onClick={() => movePath(i, 1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="min-w-0 flex-1 rounded-sm px-1.5 py-1 text-left hover:bg-muted/50"
                  >
                    <div className="truncate text-xs font-medium">
                      {letter} · {path.key}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {conditionSummary(path.condition, labels.attributes, labels.teams)}
                    </div>
                  </button>
                </div>
                {expanded === i && (
                  <div className="space-y-3 border-t p-2.5">
                    <PathNameField
                      value={path.key}
                      siblingKeys={step.paths.filter((_, j) => j !== i).map((p) => p.key)}
                      onRename={(key) => updatePath(i, { ...path, key })}
                    />
                    <ConditionEditor
                      subject="Runs when"
                      condition={path.condition}
                      onChange={(condition) => updatePath(i, { ...path, condition })}
                    />
                    <div className="flex justify-end border-t pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => requestRemove(path)}
                      >
                        Remove path
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={addPath}
        >
          <PlusIcon className="size-3.5" /> Add path
        </Button>
      </Field>

      <p className="text-xs text-muted-foreground">
        The first matching path runs, top to bottom. Keep a no-condition path last so nothing falls
        through.
      </p>

      {confirmDialog}
    </div>
  )
}

/** Path rename with local text state: commits on blur when non-empty + unique. */
function PathNameField({
  value,
  siblingKeys,
  onRename,
}: {
  value: string
  siblingKeys: string[]
  onRename: (key: string) => void
}) {
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const next = text.trim()
    if (!next || next === value) {
      setText(value)
      setError(null)
      return
    }
    if (siblingKeys.includes(next)) {
      setError('Another path already uses this name.')
      return
    }
    setError(null)
    onRename(next)
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">Path name</Label>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8 text-sm"
        maxLength={60}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
