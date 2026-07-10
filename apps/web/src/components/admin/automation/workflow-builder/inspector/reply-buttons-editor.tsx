/**
 * The `reply_buttons` block editor: the prompt body, a reorderable button
 * list (2–8 soft-capped per the design brief's "realistic ranges" — a
 * warning past 8, never a hard block since the schema itself only requires
 * >= 1), and the per-block "let customer type" toggle (allowTyping) —
 * everything the widget's button stack needs to render. Each button IS a
 * path declaration (its `key` spawns a labeled outgoing edge, the same
 * mechanics a branch path uses — see workflow-graph.ts's stepPaths), so
 * renaming a button's label never touches its key/routing.
 */
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { BlockBodyField } from './block-body-field'
import { Field, movePathAdjacent, usePathRemovalConfirm } from './shared'
import type { KeyedPath, TreeStep } from '../../workflow-graph'

const BUTTON_SOFT_CAP = 8

function freshButtonKey(paths: KeyedPath[]): string {
  const used = new Set(paths.map((p) => p.key))
  let n = paths.length + 1
  while (used.has(`option_${n}`)) n++
  return `option_${n}`
}

export function ReplyButtonsEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'reply_buttons' }>
  onChange: (step: TreeStep) => void
}) {
  const updatePath = (i: number, path: KeyedPath) =>
    onChange({ ...step, paths: step.paths.map((p, j) => (j === i ? path : p)) })
  const removePath = (key: string) =>
    onChange({ ...step, paths: step.paths.filter((p) => p.key !== key) })
  const { requestRemove, confirmDialog } = usePathRemovalConfirm(
    step.paths,
    removePath,
    (p) => p.label
  )
  const movePath = (i: number, dir: -1 | 1) => {
    const next = movePathAdjacent(step.paths, i, dir)
    if (next !== step.paths) onChange({ ...step, paths: next })
  }
  const addButton = () => {
    const key = freshButtonKey(step.paths)
    onChange({
      ...step,
      paths: [...step.paths, { key, label: `Option ${step.paths.length + 1}`, steps: [] }],
    })
  }

  return (
    <div className="space-y-3">
      <BlockBodyField
        label="Prompt"
        body={step.body}
        onChange={(body) => onChange({ ...step, body })}
        placeholder="How can we help?"
      />

      <Field label="Buttons">
        <div className="space-y-1.5">
          {step.paths.map((path, i) => {
            return (
              <div key={path.key} className="flex items-center gap-1.5 rounded-md border p-1.5">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move button up"
                    disabled={i === 0}
                    onClick={() => movePath(i, -1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move button down"
                    disabled={i === step.paths.length - 1}
                    onClick={() => movePath(i, 1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                </div>
                <Input
                  value={path.label}
                  onChange={(e) => updatePath(i, { ...path, label: e.target.value })}
                  maxLength={80}
                  className="h-8 flex-1 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => requestRemove(path)}
                >
                  Remove
                </Button>
              </div>
            )
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={addButton}
        >
          <PlusIcon className="size-3.5" /> Add button
        </Button>
        {step.paths.length > BUTTON_SOFT_CAP && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            {step.paths.length} buttons is a lot to scan at once — most journeys read best with 2–6.
          </p>
        )}
      </Field>

      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <Label className="text-xs">Let customer type instead</Label>
          <p className="text-[11px] text-muted-foreground">
            When off, the composer disables until a button is tapped.
          </p>
        </div>
        <Switch
          aria-label="Let customer type instead"
          checked={step.allowTyping}
          onCheckedChange={(allowTyping) => onChange({ ...step, allowTyping })}
        />
      </div>

      {confirmDialog}
    </div>
  )
}
