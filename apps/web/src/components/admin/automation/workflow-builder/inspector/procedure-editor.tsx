/**
 * The `call_tool` / `approval` block editor, one component for both: the two
 * kinds author the same thing (an action and its arguments) and differ only in
 * whether a person sees it first, which is the summary field. Runtime seam:
 * workflow-tool-step.ts resolves the tool against the live registry and the
 * workspace dial, then runs it or opens a proposal.
 */
import { PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field } from './shared'
import { MAX_TOOL_STEP_ARGS, MAX_TOOL_STEP_SUMMARY, type TreeStep } from '../../workflow-graph'
import { PROCEDURE_TOOLS } from '@/lib/shared/workflows/procedure-tools'

type ProcedureStep = Extract<TreeStep, { kind: 'call_tool' | 'approval' }>
type ArgEntry = [string, string | number | boolean]

/** The next argument name to offer: the first one this tool declares that is
 *  not already on the step, else a numbered fallback. Never an empty name,
 *  because two empty-named rows would collapse into one on write-back. */
function freshArgKey(tool: string, used: string[]): string {
  const declared = PROCEDURE_TOOLS.find((t) => t.name === tool)?.args ?? []
  const unused = declared.find((arg) => !used.includes(arg))
  if (unused) return unused
  let n = used.length + 1
  while (used.includes(`arg${n}`)) n++
  return `arg${n}`
}

export function ProcedureEditor({
  step,
  onChange,
}: {
  step: ProcedureStep
  onChange: (step: TreeStep) => void
}) {
  const entries = Object.entries(step.args) as ArgEntry[]
  const writeEntries = (next: ArgEntry[]) => onChange({ ...step, args: Object.fromEntries(next) })
  const updateEntry = (i: number, entry: ArgEntry) =>
    writeEntries(entries.map((e, j) => (j === i ? entry : e)))
  const addEntry = () => {
    const key = freshArgKey(
      step.tool,
      entries.map(([k]) => k)
    )
    writeEntries([...entries, [key, '']])
  }

  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select value={step.tool} onValueChange={(tool) => onChange({ ...step, tool })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Choose an action" />
          </SelectTrigger>
          <SelectContent>
            {PROCEDURE_TOOLS.map((tool) => (
              <SelectItem key={tool.name} value={tool.name}>
                {tool.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {step.kind === 'approval' && (
        <Field label="What the reviewer approves">
          <Input
            value={step.summary}
            onChange={(e) => onChange({ ...step, summary: e.target.value })}
            maxLength={MAX_TOOL_STEP_SUMMARY}
            placeholder="Refund this order"
            className="h-8 text-sm"
          />
        </Field>
      )}

      <Field label="Arguments">
        <div className="space-y-1.5">
          {entries.map(([key, value], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={key}
                onChange={(e) => updateEntry(i, [e.target.value, value])}
                aria-label="Argument name"
                maxLength={64}
                className="h-8 w-1/3 text-sm"
              />
              <Input
                value={String(value)}
                onChange={(e) => updateEntry(i, [key, e.target.value])}
                aria-label={`Value for ${key}`}
                placeholder="Text, or {variable|fallback}"
                className="h-8 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => writeEntries(entries.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        {entries.length < MAX_TOOL_STEP_ARGS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={addEntry}
          >
            <PlusIcon className="size-3.5" /> Add argument
          </Button>
        )}
      </Field>
    </div>
  )
}
