/**
 * The `collect_reply` block editor: prompt body + an attribute picker. Unlike
 * collect_data (a typed field with its own control), collect_reply just saves
 * the customer's next free-text message verbatim — workflow.schemas.ts's
 * node has no fieldType at all — so the picker is restricted to `text`
 * attributes client-side (writing a raw reply into a number/select/date slot
 * would never validate at the attribute writer).
 */
import { useWorkflowEntities } from '../entities'
import { BlockBodyField } from './block-body-field'
import { EntitySelect, Field } from './shared'
import type { TreeStep } from '../../workflow-graph'

export function CollectReplyEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'collect_reply' }>
  onChange: (step: TreeStep) => void
}) {
  const { attributes } = useWorkflowEntities()
  const textAttributes = attributes.filter((d) => d.fieldType === 'text')

  return (
    <div className="space-y-3">
      <BlockBodyField
        label="Prompt"
        body={step.body}
        onChange={(body) => onChange({ ...step, body })}
        placeholder="Anything else we should know?"
      />

      <Field label="Save reply to">
        <EntitySelect
          value={step.attributeKey}
          placeholder="Choose a text attribute"
          items={textAttributes.map((d) => ({ id: d.key, name: d.label }))}
          onChange={(attributeKey) => onChange({ ...step, attributeKey })}
        />
        {textAttributes.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            No text attributes yet — add one under Settings → Conversation data.
          </p>
        )}
      </Field>

      <p className="text-xs text-muted-foreground">
        Leaves the composer enabled; any reply that doesn&rsquo;t match resumes as an interrupt.
      </p>
    </div>
  )
}
