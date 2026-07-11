/**
 * The trigger step editor: which event starts the workflow, which channels
 * it fires for, and the workflow's class (customer-facing/exclusive vs.
 * background/parallel — support platform §4.6's dispatcher split).
 */
import { CheckIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TriggerSettingsDraft } from '../use-workflow-builder'
import { ClampedIntInput, Field, MinutesField, setDroppableSetting } from './shared'
import { RuleGroupBuilder } from './rule-group-builder'
import {
  DEFAULT_BREACH_LEAD_MINUTES,
  DEFAULT_INACTIVITY_MINUTES,
  FREQUENCY_CAP_LABELS,
  FREQUENCY_CAP_TYPES,
  MAX_BREACH_LEAD_MINUTES,
  MAX_FREQUENCY_CAP_COUNT,
  MAX_FREQUENCY_CAP_DAYS,
  MAX_INACTIVITY_MINUTES,
  SEND_WINDOW_LABELS,
  SEND_WINDOW_TYPES,
  TICKET_STATUS_CATEGORY_LABELS,
  TICKET_STATUS_CATEGORY_TYPES,
  TRIGGER_CHANNELS,
  TRIGGER_DESCRIPTIONS,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  UNRESPONSIVE_TRIGGER_TYPES,
  WORKFLOW_CLASSES,
  audienceUnreachableFieldWarning,
  defaultFrequencyCap,
  type FrequencyCap,
  type FrequencyCapType,
  type GraphCondition,
  type SendWindow,
  type WorkflowClassValue,
} from '../../workflow-graph'

/** The trigger's Audience section has no JSON-mode escape hatch of its own
 *  (unlike the condition step / branch paths, which sit inside the graph's
 *  "Edit as JSON" toggle) — a too-deep stored audience still renders (as a
 *  read-only notice, never blocking) but points at removing/replacing it
 *  here rather than "use JSON mode", which doesn't exist for trigger
 *  settings. */
const AUDIENCE_ADVANCED_FALLBACK =
  'This audience condition is nested more deeply than this editor supports. It still applies as configured — remove it here to replace it.'

export function TriggerEditor({
  triggerType,
  onChangeTriggerType,
  triggerSettings,
  onChangeTriggerSettings,
  workflowClass,
  onChangeClass,
}: {
  triggerType: string
  onChangeTriggerType: (v: string) => void
  triggerSettings: TriggerSettingsDraft
  onChangeTriggerSettings: (v: TriggerSettingsDraft) => void
  workflowClass: WorkflowClassValue
  onChangeClass: (v: WorkflowClassValue) => void
}) {
  const toggleChannel = (value: string, checked: boolean) => {
    const channels = checked
      ? [...triggerSettings.channels, value]
      : triggerSettings.channels.filter((c) => c !== value)
    onChangeTriggerSettings({ ...triggerSettings, channels })
  }

  // 'unlimited' is never written back: an absent key and a stored
  // { type: 'unlimited' } read identically to the guard (frequencyCapAllows),
  // so switching back to "No limit" just drops the key instead of storing a
  // no-op value.
  const frequencyCap = (triggerSettings.frequencyCap as FrequencyCap | undefined) ?? {
    type: 'unlimited',
  }

  const setFrequencyCapType = (type: FrequencyCapType) =>
    setDroppableSetting(
      triggerSettings,
      onChangeTriggerSettings,
      'frequencyCap',
      type === 'unlimited' ? undefined : defaultFrequencyCap(type),
      type === 'unlimited'
    )

  const setFrequencyCapDays = (days: number) =>
    onChangeTriggerSettings({
      ...triggerSettings,
      frequencyCap: { type: 'once_per_days', days },
    })

  const setFrequencyCapCount = (count: number) =>
    onChangeTriggerSettings({ ...triggerSettings, frequencyCap: { type: 'n_total', count } })

  // 'any' is never written back either, same "absence reads identically to
  // the no-op value" convention frequencyCap's 'unlimited' uses above.
  const sendWindow = (triggerSettings.sendWindow as SendWindow | undefined) ?? 'any'
  const setSendWindow = (next: SendWindow) =>
    setDroppableSetting(
      triggerSettings,
      onChangeTriggerSettings,
      'sendWindow',
      next,
      next === 'any'
    )

  const audience = (triggerSettings.audience as GraphCondition | undefined) ?? {}
  const setAudience = (next: GraphCondition) =>
    // {} ("matches everything") is the same as no audience configured at
    // all — drop the key instead of storing a no-op condition, mirroring
    // frequencyCap's 'unlimited'/sendWindow's 'any' convention above.
    setDroppableSetting(
      triggerSettings,
      onChangeTriggerSettings,
      'audience',
      next,
      Object.keys(next).length === 0
    )
  const audienceWarning = audienceUnreachableFieldWarning(triggerType, audience)

  // The timer-driven triggers' own per-workflow threshold (support platform
  // §4.6): workflow-sweep.ts / sla.service.ts read these straight off the
  // stored triggerSettings, not from a condition, so — unlike frequencyCap/
  // sendWindow/audience above — there's no "unconfigured" sentinel to drop
  // back to; an absent key just reads as the same default the sweep falls
  // back to (see workflow.schemas.ts's DEFAULT_INACTIVITY_MINUTES /
  // DEFAULT_BREACH_LEAD_MINUTES), so this always writes a concrete value.
  const isUnresponsiveTrigger = (UNRESPONSIVE_TRIGGER_TYPES as readonly string[]).includes(
    triggerType
  )
  const isApproachingBreachTrigger = triggerType === 'sla.approaching_breach'
  const inactivityMinutes =
    (triggerSettings.inactivityMinutes as number | undefined) ?? DEFAULT_INACTIVITY_MINUTES
  const setInactivityMinutes = (value: number) =>
    onChangeTriggerSettings({ ...triggerSettings, inactivityMinutes: value })
  const breachLeadMinutes =
    (triggerSettings.breachLeadMinutes as number | undefined) ?? DEFAULT_BREACH_LEAD_MINUTES
  const setBreachLeadMinutes = (value: number) =>
    onChangeTriggerSettings({ ...triggerSettings, breachLeadMinutes: value })

  // ticket.status_changed's own optional filter (ticket triggers extension):
  // "any" is never written back either, same absence-reads-as-no-op
  // convention frequencyCap/sendWindow use above.
  const isTicketStatusChangedTrigger = triggerType === 'ticket.status_changed'
  const ticketStatusCategory = (triggerSettings.ticketStatusCategory as string | undefined) ?? 'any'
  const setTicketStatusCategory = (next: string) =>
    setDroppableSetting(
      triggerSettings,
      onChangeTriggerSettings,
      'ticketStatusCategory',
      next,
      next === 'any'
    )

  return (
    <div className="space-y-4">
      <Field label="When this happens">
        <Select value={triggerType} onValueChange={onChangeTriggerType}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {TRIGGER_DESCRIPTIONS[triggerType as (typeof TRIGGER_TYPES)[number]] && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {TRIGGER_DESCRIPTIONS[triggerType as (typeof TRIGGER_TYPES)[number]]}
          </p>
        )}
      </Field>

      {isUnresponsiveTrigger && (
        <MinutesField
          label="Silence threshold"
          prefix="After"
          suffix="minutes of silence"
          value={inactivityMinutes}
          max={MAX_INACTIVITY_MINUTES}
          onCommit={setInactivityMinutes}
        />
      )}

      {isApproachingBreachTrigger && (
        <MinutesField
          label="Lead time"
          prefix="Warn"
          suffix="minutes before the deadline"
          value={breachLeadMinutes}
          max={MAX_BREACH_LEAD_MINUTES}
          onCommit={setBreachLeadMinutes}
        />
      )}

      {isTicketStatusChangedTrigger && (
        <Field label="Status category filter">
          <Select value={ticketStatusCategory} onValueChange={setTicketStatusCategory}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any status change</SelectItem>
              {TICKET_STATUS_CATEGORY_TYPES.map((c) => (
                <SelectItem key={c} value={c}>
                  {TICKET_STATUS_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Fires only when the ticket enters this status category. Only fires for a ticket with a
            linked conversation.
          </p>
        </Field>
      )}

      <Field label="Channels">
        <div className="space-y-1.5">
          {TRIGGER_CHANNELS.map((channel) => {
            const checked = triggerSettings.channels.includes(channel.value)
            return (
              <label
                key={channel.value}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                  checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleChannel(channel.value, e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                {channel.label}
              </label>
            )
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          No channels selected runs the workflow for every channel.
        </p>
      </Field>

      <Field label="Frequency cap">
        <Select
          value={frequencyCap.type}
          onValueChange={(v) => setFrequencyCapType(v as FrequencyCapType)}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_CAP_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FREQUENCY_CAP_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {frequencyCap.type === 'once_per_days' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Every</span>
            <ClampedIntInput
              value={frequencyCap.days}
              min={1}
              max={MAX_FREQUENCY_CAP_DAYS}
              onCommit={setFrequencyCapDays}
              className="h-8 w-20 text-sm"
            />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
        )}
        {frequencyCap.type === 'n_total' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">At most</span>
            <ClampedIntInput
              value={frequencyCap.count}
              min={1}
              max={MAX_FREQUENCY_CAP_COUNT}
              onCommit={setFrequencyCapCount}
              className="h-8 w-20 text-sm"
            />
            <span className="text-xs text-muted-foreground">times</span>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Limits how many times this workflow can run for the same person.
        </p>
      </Field>

      <Field label="Send window">
        <Select value={sendWindow} onValueChange={(v) => setSendWindow(v as SendWindow)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEND_WINDOW_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {SEND_WINDOW_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Restricts this trigger to fire only inside or outside the workspace&apos;s office hours.
        </p>
      </Field>

      <Field label="Audience">
        <RuleGroupBuilder
          subject="Only run for"
          condition={audience}
          onChange={setAudience}
          advancedFallback={AUDIENCE_ADVANCED_FALLBACK}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Limits this trigger to conversations, people, and companies matching these rules. No rules
          runs for everyone.
        </p>
        {audienceWarning && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">{audienceWarning}</p>
        )}
      </Field>

      <Field label="Workflow class">
        <div className="space-y-1.5">
          {WORKFLOW_CLASSES.map((c) => {
            const selected = workflowClass === c.value
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onChangeClass(c.value)}
                className={cn(
                  'relative w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                )}
              >
                <div className="text-xs font-medium">{c.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{c.description}</div>
                {selected && <CheckIcon className="absolute top-2 right-2 size-3.5 text-primary" />}
              </button>
            )
          })}
        </div>
      </Field>
    </div>
  )
}
