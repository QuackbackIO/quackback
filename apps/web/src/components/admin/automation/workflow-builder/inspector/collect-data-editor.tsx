/**
 * The `collect_data` block editor: an attribute-definition picker filtered to
 * the fieldTypes the runtime actually supports (COLLECT_FIELD_TYPES —
 * text/number/select/date; multi_select and checkbox have no collect_data
 * equivalent, see workflow.schemas.ts), a required toggle, and the prompt
 * body. Picking an attribute snapshots its fieldType (and, for select, its
 * options) onto the step so a later definition edit can't retroactively
 * change what the customer was asked — same "snapshot, not a live join"
 * rationale as WorkflowBlockAttributeOption's own doc comment.
 */
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useWorkflowEntities } from '../entities'
import { BlockBodyField } from './block-body-field'
import { EntitySelect, Field } from './shared'
import {
  COLLECT_FIELD_TYPES,
  isNeedsSetupRef,
  type TreeStep,
  type CollectFieldType,
} from '../../workflow-graph'

export function CollectDataEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'collect_data' }>
  onChange: (step: TreeStep) => void
}) {
  const { attributes } = useWorkflowEntities()
  // The type predicate (not just a boolean filter) narrows fieldType to
  // CollectFieldType here, so every reader below (onChange, the JSX) gets it
  // for free instead of re-deriving it from the wider AttributeFieldType.
  const supported = attributes.filter((d): d is typeof d & { fieldType: CollectFieldType } =>
    (COLLECT_FIELD_TYPES as readonly string[]).includes(d.fieldType)
  )
  const selectedDef = supported.find((d) => d.key === step.attributeKey)

  return (
    <div className="space-y-3">
      <BlockBodyField
        label="Prompt"
        body={step.body}
        onChange={(body) => onChange({ ...step, body })}
        placeholder="What's your order number?"
      />

      <Field label="Attribute">
        <EntitySelect
          value={step.attributeKey}
          placeholder="Choose an attribute"
          items={supported.map((d) => ({ id: d.key, name: d.label }))}
          onChange={(attributeKey) => {
            const def = supported.find((d) => d.key === attributeKey)
            onChange({
              ...step,
              attributeKey,
              fieldType: def?.fieldType ?? 'text',
              options:
                def?.fieldType === 'select'
                  ? (def.options ?? []).map((o) => ({ id: o.id, label: o.label }))
                  : undefined,
            })
          }}
        />
        {step.attributeKey && !isNeedsSetupRef(step.attributeKey) && !selectedDef && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
            This attribute no longer supports collect_data (its field type changed or it was
            archived) — choose another.
          </p>
        )}
        {supported.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            No text, number, select, or date attributes yet — add one under Settings → Conversation
            data.
          </p>
        )}
      </Field>

      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <Label className="text-xs">Required</Label>
          <p className="text-[11px] text-muted-foreground">The customer must answer to continue.</p>
        </div>
        <Switch
          checked={step.required}
          onCheckedChange={(required) => onChange({ ...step, required })}
        />
      </div>
    </div>
  )
}
