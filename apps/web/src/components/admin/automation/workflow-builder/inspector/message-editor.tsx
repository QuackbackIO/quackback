/** The `message` block editor: just its rich-text body — the plainest of the
 *  8 conversational block kinds (Phase C, slice C-5). */
import { BlockBodyField } from './block-body-field'
import type { TreeStep } from '../../workflow-graph'

export function MessageEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'message' | 'send_ticket_form' }>
  onChange: (step: TreeStep) => void
}) {
  return (
    <div className="space-y-3">
      <BlockBodyField body={step.body} onChange={(body) => onChange({ ...step, body })} />
      <p className="text-xs text-muted-foreground">
        {step.kind === 'send_ticket_form'
          ? 'Posts the ticket intake form into the conversation — the customer files a ticket right in the thread. The intro text above is optional; the run continues immediately.'
          : 'Posted as an ordinary message from the workspace assistant, then continues immediately.'}
      </p>
    </div>
  )
}
