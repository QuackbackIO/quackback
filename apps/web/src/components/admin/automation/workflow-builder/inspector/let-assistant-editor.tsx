/**
 * The `let_assistant_answer` block editor (Phase C, slice C-6). Runtime seam:
 * action.executor.ts's `let_assistant_answer` case invokes
 * runAssistantTurnForConversation(conversationId, { stepInstructions }),
 * folding `instructions` into just this one turn's system prompt (see
 * assistant.runtime.ts's buildStepInstructionsPrompt) — never the persisted
 * Settings > AI & Automation config. `autoCloseOverride` is stored and
 * round-trips through save/JSON mode, but NOTHING in the runtime reads it yet
 * (no assistant auto-close knob exists to override — see this slice's
 * report); the switch is shown with an explicit "not yet enforced" caption
 * rather than silently pretending it does something.
 */
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field } from './shared'
import { MAX_ASSISTANT_STEP_INSTRUCTIONS, type TreeStep } from '../../workflow-graph'

export function LetAssistantAnswerEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'let_assistant_answer' }>
  onChange: (step: TreeStep) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Hands the turn to Quinn using its workspace-wide configuration (Settings → AI &amp;
        Automation), plus any one-time instruction below for just this hand-off.
      </p>

      <Field label="Instructions for this step (optional)">
        <Textarea
          value={step.instructions ?? ''}
          onChange={(e) => onChange({ ...step, instructions: e.target.value || undefined })}
          maxLength={MAX_ASSISTANT_STEP_INSTRUCTIONS}
          placeholder="e.g. Focus only on billing questions; hand off anything else."
          className="min-h-20 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Added to Quinn's prompt for this turn only — it never changes the workspace-wide
          configuration.
        </p>
      </Field>

      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <Label className="text-xs">Override auto-close</Label>
          <p className="text-[11px] text-muted-foreground">
            Not yet enforced by the runtime — there is no assistant auto-close setting to override
            today. Saved for when one ships.
          </p>
        </div>
        <Switch
          aria-label="Override auto-close"
          checked={step.autoCloseOverride ?? false}
          onCheckedChange={(autoCloseOverride) => onChange({ ...step, autoCloseOverride })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Continues on its default path once Quinn answers. If the conversation escalates to a human,
        the run instead follows the “If escalated to a human” path below.
      </p>
    </div>
  )
}
