/**
 * The `request_csat` block editor. Wait-for-rating is implicit (every
 * request_csat parks the run until rated — there's no fire-and-forget mode
 * in the runtime, see graph.ts's request_csat case), so the toggles here are
 * allow-typing-while-waiting and an optional comment prompt, plus which
 * rating digits (1–5, the fixed 5-emoji CSAT) branch into their own path —
 * the same "spawns paths via edges" mechanics reply_buttons uses, keyed by
 * exact rating digit instead of a button key (graph.ts's request_csat resume
 * case: `successorId(graph, node.id, String(rating))`).
 */
import { PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BlockBodyField } from './block-body-field'
import { Field, usePathRemovalConfirm } from './shared'
import { RATING_KEYS, RATING_LABELS, type TreeStep } from '../../workflow-graph'

const DEFAULT_COMMENT_PROMPT = 'Anything you want to add?'

export function CsatEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'request_csat' }>
  onChange: (step: TreeStep) => void
}) {
  const wiredKeys = new Set(step.paths.map((p) => p.key))
  const unwired = RATING_KEYS.filter((k) => !wiredKeys.has(k))

  const addPath = (key: (typeof RATING_KEYS)[number]) =>
    onChange({ ...step, paths: [...step.paths, { key, label: RATING_LABELS[key], steps: [] }] })
  const removePath = (key: string) =>
    onChange({ ...step, paths: step.paths.filter((p) => p.key !== key) })
  const { requestRemove, confirmDialog } = usePathRemovalConfirm(
    step.paths,
    removePath,
    (p) => p.label
  )

  return (
    <div className="space-y-3">
      <BlockBodyField
        label="Prompt"
        body={step.body}
        onChange={(body) => onChange({ ...step, body })}
        placeholder="How did we do?"
      />

      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <Label className="text-xs">Let customer type instead</Label>
          <p className="text-[11px] text-muted-foreground">
            When off, the composer disables until a face is tapped.
          </p>
        </div>
        <Switch
          aria-label="Let customer type instead"
          checked={step.allowTypingInterrupt}
          onCheckedChange={(allowTypingInterrupt) => onChange({ ...step, allowTypingInterrupt })}
        />
      </div>

      <div className="space-y-2 rounded-md border p-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Ask for a comment</Label>
          <Switch
            aria-label="Ask for a comment"
            checked={step.commentPrompt !== undefined}
            onCheckedChange={(on) =>
              onChange({ ...step, commentPrompt: on ? DEFAULT_COMMENT_PROMPT : undefined })
            }
          />
        </div>
        {step.commentPrompt !== undefined && (
          <Input
            value={step.commentPrompt}
            onChange={(e) => onChange({ ...step, commentPrompt: e.target.value })}
            maxLength={200}
            placeholder={DEFAULT_COMMENT_PROMPT}
            className="h-8 text-sm"
          />
        )}
      </div>

      <Field label="Branch on rating">
        <div className="space-y-1.5">
          {step.paths.map((path) => {
            return (
              <div key={path.key} className="flex items-center gap-1.5 rounded-md border p-1.5">
                <span className="flex-1 truncate text-xs">{path.label}</span>
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
        {unwired.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <PlusIcon className="size-3.5" /> Add path for rating
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {unwired.map((key) => (
                <DropdownMenuItem key={key} onSelect={() => addPath(key)}>
                  {RATING_LABELS[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          A rating with no path still records — the run just ends there. Add a path only where the
          journey diverges (e.g. a low rating routes to an apology + hand-off).
        </p>
      </Field>

      {confirmDialog}
    </div>
  )
}
