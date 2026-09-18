import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateConversationInactivity } from '@/lib/client/mutations/settings'
import {
  inactivityPolicy,
  inactivityValidation,
  type ConversationInactivitySettings,
  type IndependentActions,
  type UpdateConversationInactivityInput,
  type InactivityMode,
} from '@/lib/shared/conversation-inactivity'

type Section = 'messenger' | 'email' | 'assistant'
const modes = { built_in: 'Built-in rules', custom: 'Custom workflows', off: 'Off' }
const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm w-full sm:w-auto'

export function ConversationInactivityCard({
  section,
  preventRepliesWhenClosed = false,
}: {
  section: Section
  preventRepliesWhenClosed?: boolean
}) {
  const query = useQuery(settingsQueries.conversationInactivity())
  const update = useUpdateConversationInactivity()
  const [draft, setDraft] = useState<ConversationInactivitySettings | null>(null)
  const [channel, setChannel] = useState<'messenger' | 'email'>('messenger')
  const settings = draft ?? query.data
  const title = section === 'assistant' ? 'Follow-up and closure' : 'Conversation behavior'
  if (!settings)
    return (
      <SettingsCard title={title}>
        {query.isError ? (
          <div role="alert">
            Could not load conversation settings.{' '}
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading conversation settings…
          </p>
        )}
      </SettingsCard>
    )
  const group = section === 'assistant' ? channel : section
  const owner = section === 'assistant' ? 'assistant' : 'team'
  const policy = inactivityPolicy(settings, owner, group)
  const raw =
    section === 'assistant'
      ? group === 'email'
        ? settings.assistant.email
        : settings.assistant
      : settings[group]
  const unit = group === 'email' ? 'hours' : 'minutes'
  const factor = group === 'email' ? 3_600_000 : 60_000
  const validation = inactivityValidation(settings, section)
  function change(
    patch: IndependentActions & {
      checkInMinutes?: number
      closeMinutes?: number
      checkInHours?: number
      closeHours?: number
    }
  ) {
    if (!settings) return
    const next = structuredClone(settings)
    if (section === 'assistant' && group === 'email') Object.assign(next.assistant.email, patch)
    else Object.assign(next[section], patch)
    setDraft(next)
  }
  function save() {
    if (!draft) return
    const input =
      section === 'assistant'
        ? { section, revision: draft.revision ?? 0, policy: draft.assistant }
        : {
            section,
            revision: draft.revision ?? 0,
            policy: draft[section],
            mode: draft.channels?.[section],
          }
    update.mutate(input as UpdateConversationInactivityInput, { onSuccess: () => setDraft(null) })
  }
  const workflows = query.data?.publishedWorkflows?.filter((w) => w.channels.includes(group)) ?? []
  const editable = section === 'assistant' || policy.mode === 'built_in'
  return (
    <SettingsCard
      title={title}
      description={
        section === 'assistant'
          ? 'Follow up once, then close conversations that stay quiet.'
          : 'Contact follow-up and closure for this channel.'
      }
    >
      <div className="space-y-5">
        {section === 'assistant' ? (
          <Tabs value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
            <TabsList>
              <TabsTrigger value="messenger">Chat</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label htmlFor={`inactivity-${section}-mode`}>Inactivity handling</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Applies to team and Quinn conversations on this channel.
              </p>
            </div>
            <select
              id={`inactivity-${section}-mode`}
              className={selectClass}
              value={policy.mode}
              disabled={update.isPending}
              onChange={(e) =>
                setDraft({
                  ...settings,
                  channels: {
                    messenger: 'built_in',
                    email: 'built_in',
                    ...settings.channels,
                    [section]: e.target.value as InactivityMode,
                  },
                })
              }
            >
              {Object.entries(modes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {policy.mode !== 'built_in' && (
          <div className="rounded-lg bg-muted/40 p-3 space-y-2 text-sm">
            <p>
              {policy.mode === 'off'
                ? 'Inactivity automation is off for'
                : 'Custom workflows handle'}{' '}
              {group === 'email' ? 'email' : 'Messenger'} conversations. Saved built-in settings are
              retained.
            </p>
            {policy.mode === 'custom' && (
              <>
                <p className="text-xs text-muted-foreground">
                  Conversations outside these workflows’ audience filters receive no automatic
                  fallback.
                </p>
                {workflows.length ? (
                  <ul className="list-disc pl-4">
                    {workflows.map((w) => (
                      <li key={w.id}>{w.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No published customer-inactivity workflows apply to this channel.</p>
                )}
                <Link to="/admin/automation/workflows" className="font-medium text-primary">
                  Manage workflows
                </Link>
              </>
            )}
          </div>
        )}
        {editable && (
          <fieldset disabled={update.isPending} className="space-y-4 min-w-0">
            {section !== 'assistant' && <h3 className="text-sm font-medium">Team conversations</h3>}
            {section === 'assistant' ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                <Label htmlFor={`follow-purpose-${group}`}>Follow-up</Label>
                <select
                  id={`follow-purpose-${group}`}
                  className={selectClass}
                  value={policy.followUpEnabled ? policy.purpose : 'none'}
                  onChange={(e) =>
                    change(
                      e.target.value === 'none'
                        ? { followUpEnabled: false }
                        : {
                            followUpEnabled: true,
                            followUpPurpose: e.target.value as
                              'check_resolution' | 'offer_human_help',
                          }
                    )
                  }
                >
                  <option value="none">None</option>
                  <option value="check_resolution">Check resolution</option>
                  <option value="offer_human_help">Offer human help</option>
                </select>
              </div>
            ) : (
              <Toggle
                id={`${section}-follow`}
                label="Send a follow-up"
                checked={policy.followUpEnabled}
                onChange={(followUpEnabled) => change({ followUpEnabled })}
              />
            )}
            {policy.followUpEnabled && (
              <Duration
                key={`${group}-follow`}
                id={`${section}-${group}-follow-after`}
                label="Follow-up after"
                value={policy.followUpMs / factor}
                unit={unit}
                onChange={(value) =>
                  change(group === 'email' ? { checkInHours: value } : { checkInMinutes: value })
                }
              />
            )}
            {section === 'assistant' ? (
              <p className="text-xs text-muted-foreground">
                Follow-up applies after Quinn answers. Clarification-only conversations use the
                unanswered closure choice below. Silence is never a confirmed resolution.
              </p>
            ) : group === 'messenger' && policy.followUpEnabled ? (
              <p className="text-xs text-muted-foreground">
                Sent once, only while the visitor is online.
              </p>
            ) : null}
            <Toggle
              id={`${section}-${group}-close`}
              label="Auto-close"
              checked={policy.closeEnabled}
              onChange={(closeEnabled) => change({ closeEnabled })}
            />
            {policy.closeEnabled && (
              <>
                <Duration
                  key={`${group}-close`}
                  id={`${section}-${group}-close-after`}
                  label="Close after"
                  value={policy.closeMs / factor}
                  unit={unit}
                  onChange={(value) =>
                    change(group === 'email' ? { closeHours: value } : { closeMinutes: value })
                  }
                />
                {section === 'assistant' && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Close inactive conversations:</p>
                    <Toggle
                      id={`${group}-answered`}
                      label="After Quinn answered"
                      checked={policy.closeWhenAnswered}
                      onChange={(closeWhenAnswered) => change({ closeWhenAnswered })}
                    />
                    <Toggle
                      id={`${group}-unanswered`}
                      label="While Quinn is waiting for more information"
                      checked={policy.closeWhenUnanswered}
                      onChange={(closeWhenUnanswered) => change({ closeWhenUnanswered })}
                    />
                  </div>
                )}
              </>
            )}
            {validation && (
              <p role="alert" className="text-sm text-destructive">
                {validation}
              </p>
            )}
            <div className="rounded-lg bg-muted/40 p-3 space-y-1" aria-label="Timing preview">
              <p className="text-sm">
                {section === 'assistant' ? 'Answer' : 'Last team reply'}
                {policy.followUpEnabled && ` → ${policy.followUpMs / factor} ${unit}: Follow-up`}
                {policy.closeEnabled && ` → ${policy.closeMs / factor} ${unit}: Close`}
              </p>
              <p className="text-xs text-muted-foreground">
                Both timers start after the {section === 'assistant' ? 'answer' : 'last team reply'}
                . A customer reply cancels these actions.
              </p>
            </div>
            {(policy.followUpEnabled || (policy.closeEnabled && !(section === 'email'))) && (
              <details className="space-y-3">
                <summary className="cursor-pointer text-sm font-medium">Customize messages</summary>
                {policy.followUpEnabled && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${section}-${group}-follow-message`}>Follow-up message</Label>
                    <Textarea
                      id={`${section}-${group}-follow-message`}
                      value={raw.followUpMessage ?? ''}
                      maxLength={500}
                      placeholder={
                        section === 'assistant'
                          ? policy.purpose === 'offer_human_help'
                            ? 'Still need help? Reply here and I can connect you with the team.'
                            : 'Did that answer your question? Reply here if you still need help.'
                          : 'Still need a hand? Reply here and we’ll pick it back up.'
                      }
                      onChange={(e) => change({ followUpMessage: e.target.value })}
                    />
                  </div>
                )}
                {policy.closeEnabled && section !== 'email' && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${section}-${group}-close-message`}>Closing message</Label>
                    <Textarea
                      id={`${section}-${group}-close-message`}
                      value={raw.closingMessage ?? ''}
                      maxLength={500}
                      placeholder={
                        preventRepliesWhenClosed && group === 'messenger'
                          ? 'This conversation has been closed. Start a new conversation if you still need help.'
                          : 'This conversation has been closed. Reply to reopen if you still need help.'
                      }
                      onChange={(e) => change({ closingMessage: e.target.value })}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the translated default. Custom messages appear exactly as
                  written.
                </p>
              </details>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                After closing:{' '}
                {group === 'messenger' && preventRepliesWhenClosed
                  ? 'customers start a new conversation'
                  : 'customers can reply to reopen'}
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                {section === 'email' ? 'Team email conversations close silently. ' : ''}Snooze
                pauses inactivity automation for a conversation. Waking starts a fresh inactivity
                period.
              </p>
            </details>
          </fieldset>
        )}
        {section !== 'assistant' && policy.mode === 'built_in' && (
          <div className="border-t pt-4 space-y-1">
            <h3 className="text-sm font-medium">Quinn conversations</h3>
            <p className="text-xs text-muted-foreground">{summary(settings, group)}</p>
            <Link to="/admin/automation/agent" className="text-sm font-medium text-primary">
              Configure Quinn
            </Link>
          </div>
        )}
        {update.isError && (
          <p role="alert" className="text-sm text-destructive">
            {update.error.message || 'Could not save. Your changes are still here.'}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={!draft || update.isPending}
            onClick={() => {
              setDraft(null)
              update.reset()
            }}
          >
            Cancel
          </Button>
          <Button disabled={!draft || !!validation || update.isPending} onClick={save}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}
function summary(settings: ConversationInactivitySettings, group: 'messenger' | 'email') {
  const p = inactivityPolicy(settings, 'assistant', group),
    factor = group === 'email' ? 3_600_000 : 60_000,
    unit = group === 'email' ? 'h' : 'm'
  return `${p.followUpEnabled ? `Follow-up after ${p.followUpMs / factor}${unit}` : 'Follow-up off'} · ${p.closeEnabled ? `Close after ${p.closeMs / factor}${unit}` : 'Auto-close off'}`
}
function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
function Duration({
  id,
  label,
  value,
  unit,
  onChange,
}: {
  id: string
  label: string
  value: number
  unit: 'minutes' | 'hours'
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="w-24"
          type="number"
          min={unit === 'hours' ? 1 : 3}
          max={unit === 'hours' ? 168 : 1440}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isInteger(n)) onChange(n)
          }}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
