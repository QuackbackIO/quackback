/**
 * The action step editor, ported from the old popover version: each action
 * type's config UI (team/agent selects, tag picker, priority, snooze, SLA
 * policy, set attribute). Logic and config shapes are unchanged — only the
 * home (inspector panel instead of a popover) and the entity source (the
 * shared WorkflowEntitiesProvider instead of a canvas-local context) differ.
 */
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { AttributeValueInput } from '@/components/admin/conversation/attribute-value-input'
import { MAX_CONVERSATION_MESSAGE_LENGTH } from '@/lib/shared/conversation/types'
import { useWorkflowEntities } from '../entities'
import { Field, EntitySelect, DurationInput } from './shared'
import {
  ACTION_LABELS,
  ACTION_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  attributeValueText,
  defaultAction,
  isNeedsSetupRef,
  parseAttributeValue,
  type ActionType,
  type GraphAction,
} from '../../workflow-graph'

type SnoozeAction = Extract<GraphAction, { type: 'snooze' }>
type SnoozeMode = 'reply' | 'duration' | 'datetime'

/** Default duration (1 hour) when switching into relative mode — matches the
 *  wait step's own default (createStep's 'wait' case, workflow-graph.ts). */
const DEFAULT_SNOOZE_SECONDS = 3600

function snoozeMode(action: SnoozeAction): SnoozeMode {
  if ('seconds' in action) return 'duration'
  return action.untilIso === null ? 'reply' : 'datetime'
}

export function ActionEditor({
  action,
  onChange,
}: {
  action: GraphAction
  onChange: (action: GraphAction) => void
}) {
  const { members, teams, tags, slaPolicies, ticketStatuses, attributes } = useWorkflowEntities()

  const setSnoozeMode = (mode: SnoozeMode) => {
    if (mode === 'reply') return onChange({ type: 'snooze', untilIso: null })
    if (mode === 'duration') return onChange({ type: 'snooze', seconds: DEFAULT_SNOOZE_SECONDS })
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    onChange({ type: 'snooze', untilIso: d.toISOString() })
  }

  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select
          value={action.type}
          onValueChange={(v) => v !== action.type && onChange(defaultAction(v as ActionType))}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ACTION_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {action.type === 'assign_agent' && (
        <Field label="Teammate">
          <EntitySelect
            value={action.principalId}
            placeholder="Choose teammate"
            items={members}
            onChange={(principalId) => onChange({ ...action, principalId })}
          />
        </Field>
      )}

      {action.type === 'assign_team' && (
        <Field label="Team">
          <EntitySelect
            value={action.teamId}
            placeholder="Choose team"
            items={teams}
            onChange={(teamId) => onChange({ ...action, teamId })}
          />
        </Field>
      )}

      {(action.type === 'add_tag' || action.type === 'remove_tag') && (
        <Field label="Tag">
          <EntitySelect
            value={action.tagId}
            placeholder="Choose tag"
            items={tags}
            onChange={(tagId) => onChange({ ...action, tagId })}
          />
        </Field>
      )}

      {action.type === 'set_priority' && (
        <Field label="Priority">
          <Select
            value={action.priority}
            onValueChange={(priority) =>
              onChange({ ...action, priority: priority as typeof action.priority })
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {action.type === 'snooze' && (
        <>
          <Field label="Snooze">
            <Select
              value={snoozeMode(action)}
              onValueChange={(v) => setSnoozeMode(v as SnoozeMode)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reply">Until they reply</SelectItem>
                <SelectItem value="duration">For a duration</SelectItem>
                <SelectItem value="datetime">Until a date &amp; time</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {'seconds' in action && (
            <Field label="Duration">
              <DurationInput
                seconds={action.seconds}
                onChange={(seconds) => onChange({ type: 'snooze', seconds })}
              />
            </Field>
          )}
          {!('seconds' in action) && action.untilIso !== null && (
            <DateTimePicker
              value={new Date(action.untilIso)}
              minDate={new Date()}
              onChange={(d) => d && onChange({ type: 'snooze', untilIso: d.toISOString() })}
            />
          )}
        </>
      )}

      {action.type === 'apply_sla' && (
        <Field label="SLA policy">
          {/* Template needs-setup placeholders read as unset (show the
              placeholder text), unlike a real-but-unresolved stored id. */}
          <Select
            value={isNeedsSetupRef(action.policyId) ? undefined : action.policyId || undefined}
            onValueChange={(policyId) => onChange({ ...action, policyId })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Choose SLA policy" />
            </SelectTrigger>
            <SelectContent>
              {slaPolicies.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex flex-col items-start">
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.targetsSummary}</span>
                  </span>
                </SelectItem>
              ))}
              {/* A stored id that no longer resolves (archived / imported JSON)
                  stays selectable so the step doesn't render blank. */}
              {action.policyId &&
                !isNeedsSetupRef(action.policyId) &&
                !slaPolicies.some((p) => p.id === action.policyId) && (
                  <SelectItem value={action.policyId}>
                    <span className="font-mono text-xs">{action.policyId}</span>
                  </SelectItem>
                )}
            </SelectContent>
          </Select>
        </Field>
      )}

      {action.type === 'set_attribute' && (
        <>
          <Field label="Attribute">
            <EntitySelect
              value={action.key}
              placeholder="Choose attribute"
              items={attributes.map((d) => ({ id: d.key, name: d.label }))}
              // Reset the value on a definition switch: types differ.
              onChange={(key) => onChange({ ...action, key, value: null })}
            />
          </Field>
          {(() => {
            const def = attributes.find((d) => d.key === action.key)
            if (def) {
              return (
                <Field label="Value">
                  <AttributeValueInput
                    definition={def}
                    value={action.value}
                    onChange={(value) => onChange({ ...action, value })}
                    className="w-full"
                  />
                </Field>
              )
            }
            // A stored graph can reference a key with no live definition
            // (archived, or authored before the registry): keep the raw
            // JSON-typed input so the node stays editable.
            if (action.key) {
              return (
                <Field label="Value">
                  <Input
                    value={attributeValueText(action.value)}
                    onChange={(e) =>
                      onChange({ ...action, value: parseAttributeValue(e.target.value) })
                    }
                    placeholder="vip"
                    className="h-8 text-sm"
                  />
                </Field>
              )
            }
            return null
          })()}
        </>
      )}

      {action.type === 'add_note' && (
        <Field label="Note">
          <Textarea
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
            maxLength={MAX_CONVERSATION_MESSAGE_LENGTH}
            placeholder="e.g. Escalated per the customer's VIP tier — routing to the billing team."
            className="min-h-20 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Posted as an internal note, visible to teammates only — never to the customer. Plain
            text for now.
          </p>
        </Field>
      )}

      {action.type === 'close' && (
        <p className="text-xs text-muted-foreground">
          Closes the conversation and ends the run for this path.
        </p>
      )}

      {action.type === 'reopen' && (
        <p className="text-xs text-muted-foreground">
          Reopens a closed conversation, moving it back into an active queue.
        </p>
      )}

      {action.type === 'set_ticket_status' && (
        <Field label="Ticket status">
          <EntitySelect
            value={action.statusId}
            placeholder="Choose ticket status"
            items={ticketStatuses}
            onChange={(statusId) => onChange({ ...action, statusId })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Applies to the conversation&apos;s linked customer ticket. No linked ticket fails this
            step.
          </p>
        </Field>
      )}

      {action.type === 'convert_to_ticket' && (
        <p className="text-xs text-muted-foreground">
          Creates a customer ticket from this conversation and links it. Already linked to a ticket?
          Does nothing.
        </p>
      )}
    </div>
  )
}
