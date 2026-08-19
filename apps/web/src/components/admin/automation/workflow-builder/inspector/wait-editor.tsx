/** The wait step editor, ported unchanged from the old popover version. The
 *  amount+unit input itself is DurationInput (shared.tsx), shared with the
 *  snooze action's relative-duration mode (action-editor.tsx) so the two pick
 *  the same way. */
import { Field, DurationInput } from './shared'

export function WaitEditor({
  seconds,
  onChange,
}: {
  seconds: number
  onChange: (seconds: number) => void
}) {
  return (
    <div className="space-y-2">
      <Field label="Wait for">
        <DurationInput seconds={seconds} onChange={onChange} />
      </Field>
      <p className="text-xs text-muted-foreground">
        The run pauses here, then continues. A reply or close ends the wait.
      </p>
    </div>
  )
}
