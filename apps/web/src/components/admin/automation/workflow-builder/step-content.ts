/**
 * Card copy for the workflow step list: eyebrow, title, tone, chips, and
 * trigger sections. Shared with the inspector so a step reads the same
 * in both places.
 */
import {
  ACTION_LABELS,
  BLOCK_STEP_LABELS,
  durationPhrase,
  frequencyCapSummary,
  OPERATOR_LABELS,
  PRIORITY_LABELS,
  RATING_EMOJI,
  RATING_KEYS,
  TRIGGER_CHANNELS,
  VALUELESS_OPERATORS,
  blockBodyPreview,
  collectDataSummary,
  collectReplySummary,
  conditionSummary,
  conditionToDraft,
  countSteps,
  isBlockBodyEmpty,
  isNeedsSetupRef,
  resolveConditionField,
  sendWindowSummary,
  waitSummary,
  type ActionType,
  type AttributeFieldDef,
  type PersonCompanyAttributeFieldDef,
  type BlockStepKind,
  type EntityLabels,
  type FrequencyCap,
  type GraphAction,
  type GraphCondition,
  type KeyedPath,
  type SendWindow,
  type TreeStep,
} from '../workflow-graph'
import { truncate } from '@/lib/shared/utils/string'
import { ASSISTANT_WAIT_MINUTES_WHEN_AUTO_CLOSE_OFF } from '@/lib/shared/workflows/abandoned-auto-close'

export type Tone = 'amber' | 'violet' | 'green' | 'blue' | 'pink'

/** Icon lookup key: the trigger, a step kind, (for actions) the action type,
 *  or (for conversational blocks) the block kind. */
export type IconKey = 'trigger' | 'condition' | 'branch' | 'wait' | ActionType | BlockStepKind

export interface ChipData {
  label: string
  tone?: Tone
  /** Long warn chips (Let Quinn escalate) wrap inside the card. */
  wrap?: boolean
}

export interface StepSectionData {
  label: string
  chips: ChipData[]
}

export interface StepNodeData {
  stepId: string
  eyebrow: string
  title: string
  icon: IconKey
  tone: Tone
  chips?: ChipData[]
  meta?: string
  sections?: StepSectionData[]
  startTag?: boolean
  warn: boolean
  selected: boolean
  /** False only for the trigger — every other step card can be removed. */
  deletable: boolean
  /** Fan-out cards: steps nested in their paths, for delete confirmation. */
  nestedCount?: number
}

export interface RulePart {
  text: string
  bold?: boolean
}

export interface StepContentContext {
  labels: EntityLabels
  stepIssues: ReadonlyMap<string, string>
  selectedId: string | null
  /** Minutes until a silent Quinn park escalates (engine: 10, or auto-close waitMinutes). */
  assistantEscalateMinutes?: number
}

export const ACTION_TONE: Record<ActionType, Tone> = {
  assign_agent: 'green',
  assign_team: 'green',
  add_tag: 'green',
  remove_tag: 'green',
  set_priority: 'green',
  apply_sla: 'green',
  set_attribute: 'green',
  snooze: 'amber',
  close: 'blue',
  reopen: 'blue',
  add_note: 'green',
  set_ticket_status: 'green',
  convert_to_ticket: 'blue',
  send_webhook: 'green',
}

function assistantEscalatePhrase(minutes: number): string {
  return `${minutes} min`
}

/** Ref -> display name, tolerant of an unset or needs-setup-template ref. */
function named(
  id: string,
  lookup: ReadonlyMap<string, string> | undefined,
  missing: string
): string {
  if (!id || isNeedsSetupRef(id)) return missing
  return lookup?.get(id) ?? id
}

function actionChips(action: GraphAction, labels: EntityLabels): ChipData[] {
  switch (action.type) {
    case 'assign_agent':
      return [{ label: named(action.principalId, labels.members, 'Choose a teammate…') }]
    case 'assign_team':
      return [{ label: named(action.teamId, labels.teams, 'Choose a team…') }]
    case 'add_tag':
    case 'remove_tag':
      return [{ label: named(action.tagId, labels.tags, 'Choose a tag…') }]
    case 'set_priority':
      return [
        {
          label: PRIORITY_LABELS[action.priority],
          tone: action.priority === 'high' || action.priority === 'urgent' ? 'amber' : undefined,
        },
      ]
    case 'apply_sla':
      return [{ label: named(action.policyId, labels.slaPolicies, 'Choose an SLA policy…') }]
    case 'set_attribute':
      return [{ label: action.key || 'Choose an attribute…' }]
    case 'snooze':
      return [
        {
          label:
            'seconds' in action
              ? `For ${durationPhrase(action.seconds)}`
              : action.untilIso
                ? new Date(action.untilIso).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : 'Until they reply',
        },
      ]
    case 'add_note':
      return [{ label: action.body.trim() ? truncate(action.body.trim(), 40) : 'Write a note…' }]
    case 'set_ticket_status':
      return [{ label: named(action.statusId, labels.ticketStatuses, 'Choose a status…') }]
    case 'send_webhook':
      return [{ label: action.url ? truncate(action.url, 40) : 'Set a URL…' }]
    case 'close':
    case 'reopen':
    case 'convert_to_ticket':
      return []
  }
}

export function buildStepNodeData(step: TreeStep, ctx: StepContentContext): StepNodeData {
  const base = {
    stepId: step.id,
    warn: ctx.stepIssues.has(step.id),
    selected: ctx.selectedId === step.id,
    deletable: true,
  }
  switch (step.kind) {
    case 'condition':
      return {
        ...base,
        eyebrow: 'Condition',
        title: 'Continue if…',
        icon: 'condition',
        tone: 'violet',
        meta: conditionSummary(
          step.condition,
          ctx.labels.attributes,
          ctx.labels.teams,
          ctx.labels.personAttributes,
          ctx.labels.companyAttributes,
          ctx.labels.ticketTypes
        ),
      }
    case 'branch': {
      const n = step.paths.length
      return {
        ...base,
        eyebrow: 'Branch · first match',
        title: `${n} path${n === 1 ? '' : 's'}`,
        icon: 'branch',
        tone: 'violet',
        meta: 'Evaluated top to bottom',
        nestedCount: step.paths.reduce((sum, p) => sum + countSteps(p.steps), 0),
      }
    }
    case 'wait':
      return {
        ...base,
        eyebrow: 'Wait',
        title: waitSummary(step.seconds),
        icon: 'wait',
        tone: 'amber',
      }
    case 'action':
      return {
        ...base,
        eyebrow: 'Action',
        title: ACTION_LABELS[step.action.type],
        icon: step.action.type,
        tone: ACTION_TONE[step.action.type],
        chips: actionChips(step.action, ctx.labels),
        meta:
          step.action.type === 'close'
            ? 'Ends the workflow'
            : step.action.type === 'reopen'
              ? 'Reactivates the conversation'
              : undefined,
      }
    case 'message':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.message,
        icon: 'message',
        tone: 'pink',
        meta: blockBodyPreview(step.body),
      }
    case 'send_ticket_form':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.send_ticket_form,
        icon: 'send_ticket_form',
        tone: 'pink',
        meta: isBlockBodyEmpty(step.body) ? 'Ticket intake form' : blockBodyPreview(step.body),
      }
    case 'show_reply_time':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.show_reply_time,
        icon: 'show_reply_time',
        tone: 'pink',
        meta: "We're online — typically replies in under an hour.",
      }
    case 'disable_composer':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.disable_composer,
        icon: 'disable_composer',
        tone: 'pink',
        meta: 'Composer hint: “Choose an option above”',
      }
    case 'let_assistant_answer':
      return {
        ...base,
        eyebrow: 'Step',
        title: BLOCK_STEP_LABELS.let_assistant_answer,
        icon: 'let_assistant_answer',
        tone: 'pink',
        chips: [
          {
            label: `Escalates after ${assistantEscalatePhrase(ctx.assistantEscalateMinutes ?? ASSISTANT_WAIT_MINUTES_WHEN_AUTO_CLOSE_OFF)} if Quinn can't reply`,
            tone: 'amber',
            wrap: true,
          },
        ],
        nestedCount: step.paths.reduce((sum, p) => sum + countSteps(p.steps), 0),
      }
    case 'reply_buttons':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.reply_buttons,
        icon: 'reply_buttons',
        tone: 'pink',
        meta: blockBodyPreview(step.body),
        chips: step.paths.map((p) => ({ label: p.label })),
        nestedCount: step.paths.reduce((sum, p) => sum + countSteps(p.steps), 0),
      }
    case 'collect_data':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.collect_data,
        icon: 'collect_data',
        tone: 'pink',
        meta: collectDataSummary(step, ctx.labels.attributes),
      }
    case 'collect_reply':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.collect_reply,
        icon: 'collect_reply',
        tone: 'pink',
        meta: collectReplySummary(step, ctx.labels.attributes),
      }
    case 'request_csat':
      return {
        ...base,
        eyebrow: 'Message',
        title: BLOCK_STEP_LABELS.request_csat,
        icon: 'request_csat',
        tone: 'pink',
        meta: RATING_KEYS.map((k) => RATING_EMOJI[k]).join(' '),
        nestedCount: step.paths.reduce((sum, p) => sum + countSteps(p.steps), 0),
      }
  }
}

const TRIGGER_CHANNEL_LABELS = new Map(TRIGGER_CHANNELS.map((c) => [c.value, c.label]))

function isAudienceConfigured(condition: GraphCondition | undefined): condition is GraphCondition {
  return condition !== undefined && Object.keys(condition).length > 0
}

function triggerSections(
  channels: string[],
  frequencyCap: FrequencyCap | undefined,
  audience: GraphCondition | undefined,
  sendWindow: SendWindow | undefined,
  labels: EntityLabels = {}
): StepSectionData[] {
  const channelChips: ChipData[] = channels.length
    ? channels.map((c) => ({ label: TRIGGER_CHANNEL_LABELS.get(c) ?? c }))
    : [{ label: 'All channels' }]
  const sections: StepSectionData[] = [
    { label: 'Channels', chips: channelChips },
    { label: 'Frequency cap', chips: [{ label: frequencyCapSummary(frequencyCap) }] },
  ]
  if (isAudienceConfigured(audience)) {
    sections.push({
      label: 'Audience',
      chips: [
        {
          label: conditionSummary(
            audience,
            labels.attributes,
            labels.teams,
            labels.personAttributes,
            labels.companyAttributes,
            labels.ticketTypes
          ),
        },
      ],
    })
  }
  if (sendWindow && sendWindow !== 'any') {
    sections.push({ label: 'Send window', chips: [{ label: sendWindowSummary(sendWindow) }] })
  }
  return sections
}

export function buildTriggerNodeData(
  triggerId: string,
  triggerLabel: string,
  channels: string[],
  frequencyCap: FrequencyCap | undefined,
  audience: GraphCondition | undefined,
  sendWindow: SendWindow | undefined,
  ctx: StepContentContext
): StepNodeData {
  return {
    stepId: triggerId,
    eyebrow: 'Trigger',
    title: triggerLabel,
    icon: 'trigger',
    tone: 'amber',
    startTag: true,
    sections: triggerSections(channels, frequencyCap, audience, sendWindow, ctx.labels),
    warn: false,
    deletable: false,
    selected: ctx.selectedId === triggerId,
  }
}

/** Bold-highlighted rule-pill copy for one branch path's condition. */
export function describeBranchPath(
  condition: GraphCondition,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map(),
  teams: ReadonlyMap<string, string> = new Map(),
  personAttributes: ReadonlyMap<string, PersonCompanyAttributeFieldDef> = new Map(),
  companyAttributes: ReadonlyMap<string, PersonCompanyAttributeFieldDef> = new Map(),
  ticketTypes: ReadonlyMap<string, string> = new Map()
): RulePart[] {
  const draft = conditionToDraft(condition)
  if (draft.kind === 'advanced') {
    return [
      {
        text: conditionSummary(
          condition,
          attributes,
          teams,
          personAttributes,
          companyAttributes,
          ticketTypes
        ),
      },
    ]
  }
  if (draft.rules.length === 0) return [{ text: 'No conditions · matches everything' }]
  if (draft.rules.length > 1) {
    return [
      {
        text: conditionSummary(
          condition,
          attributes,
          teams,
          personAttributes,
          companyAttributes,
          ticketTypes
        ),
      },
    ]
  }

  const rule = draft.rules[0]!
  const meta = resolveConditionField(
    rule.field,
    attributes,
    teams,
    personAttributes,
    companyAttributes,
    ticketTypes
  )
  const op = OPERATOR_LABELS[rule.op]
  if (VALUELESS_OPERATORS.has(rule.op)) {
    return [{ text: 'If ' }, { text: meta.label, bold: true }, { text: ` ${op}` }]
  }
  let value = rule.value
  if (meta.kind === 'choice') {
    value = meta.options?.find((o) => o.value === rule.value)?.label ?? rule.value
  } else if (meta.kind === 'boolean') {
    value = rule.value === 'true' ? 'yes' : 'no'
  } else if (meta.kind === 'list' && meta.options) {
    const ids = rule.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    value = ids.map((id) => meta.options!.find((o) => o.value === id)?.label ?? id).join(', ')
  }
  return [
    { text: 'If ' },
    { text: meta.label, bold: true },
    { text: ` ${op} ` },
    { text: value || '…', bold: true },
  ]
}

/** Tab label for one fan-out path. Branch paths describe their condition;
 *  button/rating/outcome paths just name the choice. */
export function fanPathLabel(step: TreeStep, path: KeyedPath, ctx: StepContentContext): string {
  if (step.kind !== 'branch') return path.label
  const branchPath = step.paths.find((p) => p.key === path.key)
  if (!branchPath) return path.label
  const joined = describeBranchPath(
    branchPath.condition,
    ctx.labels.attributes,
    ctx.labels.teams,
    ctx.labels.personAttributes,
    ctx.labels.companyAttributes,
    ctx.labels.ticketTypes
  )
    .map((part) => part.text)
    .join('')
  return joined || path.label
}
