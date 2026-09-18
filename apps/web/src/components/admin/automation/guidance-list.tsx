import { useState } from 'react'
import { ZodError } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/solid'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { skillQueries } from '@/lib/client/queries/assistant-skills'
import {
  useCreateGuidanceRule,
  useUpdateGuidanceRule,
  useDeleteGuidanceRule,
  useUpdateAssistantVoice,
} from '@/lib/client/mutations/assistant'
import { useUpdateSkill, useDeleteSkill } from '@/lib/client/mutations/assistant-skills'
import { assistantGuidanceRuleInputSchema } from '@/lib/shared/assistant/guidance'
import { skillInputSchema } from '@/lib/shared/assistant/skills'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SearchInput } from '@/components/shared/search-input'
import { isAssistantFieldManaged, useUnsavedChanges } from './assistant-form'
import { guidanceEntries, GUIDANCE_USE_LABELS, type GuidanceEntry } from './guidance-entries'

interface Draft {
  entry: GuidanceEntry | null
  name: string
  instruction: string
  condition: string
  scenario: boolean
  enabled: boolean
  use: 'agent' | 'copilot'
}

export function GuidanceList() {
  const settings = useQuery(assistantQueries.settings())
  const rules = useQuery(assistantQueries.guidanceRules())
  const skills = useQuery(skillQueries.list())
  const createRule = useCreateGuidanceRule()
  const updateRule = useUpdateGuidanceRule()
  const deleteRule = useDeleteGuidanceRule()
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const updateVoice = useUpdateAssistantVoice()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'All' | 'Always' | 'Situations'>('All')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initial, setInitial] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<{ entry: GuidanceEntry | null } | null>(
    null
  )
  const dirty = draft !== null && JSON.stringify(draft) !== initial
  useUnsavedChanges(dirty, 'guidance')
  const busy = [createRule, updateRule, deleteRule, updateSkill, deleteSkill, updateVoice].some(
    (m) => m.isPending
  )

  function open(entry: GuidanceEntry | null) {
    const next: Draft = {
      entry,
      name: entry?.name ?? '',
      instruction: entry?.instruction ?? '',
      condition: entry?.condition ?? '',
      scenario: entry ? entry.condition !== null : true,
      enabled: entry?.enabled ?? true,
      use: entry?.uses[0] === 'copilot' ? 'copilot' : 'agent',
    }
    setDraft(next)
    setInitial(JSON.stringify(next))
    setError('')
  }
  function select(entry: GuidanceEntry | null) {
    if (busy) return
    if (dirty) {
      setPendingSelection({ entry })
      setDiscarding(true)
    } else open(entry)
  }
  function close() {
    setPendingSelection(null)
    if (busy) return
    if (dirty) setDiscarding(true)
    else setDraft(null)
  }
  function change(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : null))
    setError('')
  }
  const managed =
    draft?.entry?.source === 'managed' ||
    (draft?.entry?.source === 'voice' &&
      isAssistantFieldManaged(
        settings.data?.managedFieldPaths ?? [],
        'agents.agent.voice.additionalInstructions'
      ))

  async function save() {
    if (!draft || managed || busy) return
    setError('')
    try {
      const entry = draft.entry
      if (entry?.source === 'voice') {
        if (draft.instruction.length > 2000) throw new Error('Use 2,000 characters or fewer.')
        await updateVoice.mutateAsync({
          expectedRevision: entry.revision,
          voice: { ...entry.voice, additionalInstructions: draft.instruction },
        })
      } else if (entry?.source === 'skill') {
        const value = skillInputSchema.parse({
          ...entry.skill,
          name: draft.name,
          whenToUse: draft.condition,
          instructions: draft.instruction,
          enabled: draft.enabled,
        })
        const saved = await updateSkill.mutateAsync({ id: entry.skill.id, ...value })
        if (!saved) throw new Error('This guidance was removed. Reload the list.')
      } else {
        const value = assistantGuidanceRuleInputSchema.parse({
          name: draft.name,
          instruction: draft.instruction,
          appliesWhen: draft.scenario ? draft.condition : null,
          enabled: draft.enabled,
          agent: entry?.source === 'rule' ? entry.rule.agent : draft.use,
          priority: entry?.source === 'rule' ? entry.rule.priority : 0,
        })
        if (entry?.source === 'rule') {
          const saved = await updateRule.mutateAsync({ id: entry.rule.id, ...value })
          if (!saved) throw new Error('This guidance was removed. Reload the list.')
        } else await createRule.mutateAsync(value)
      }
      setDraft(null)
    } catch (err) {
      setError(
        err instanceof ZodError
          ? (err.issues[0]?.message ?? 'Check your guidance.')
          : err instanceof Error
            ? err.message
            : 'Could not save guidance. Your changes are still here.'
      )
    }
  }
  async function remove() {
    if (!draft?.entry || busy) return
    try {
      if (draft.entry.source === 'skill') await deleteSkill.mutateAsync(draft.entry.skill.id)
      else if (draft.entry.source === 'rule') await deleteRule.mutateAsync(draft.entry.rule.id)
      setDeleting(false)
      setDraft(null)
    } catch (err) {
      setDeleting(false)
      setError(err instanceof Error ? err.message : 'Could not delete guidance.')
    }
  }

  if (
    (!settings.data || !rules.data || !skills.data) &&
    (settings.isError || rules.isError || skills.isError)
  )
    return (
      <div role="alert" className="space-y-3">
        <p>Guidance could not be loaded.</p>
        <Button
          variant="outline"
          onClick={() => {
            void settings.refetch()
            void rules.refetch()
            void skills.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  if (!settings.data || !rules.data || !skills.data) return <p role="status">Loading guidance…</p>
  const entries = guidanceEntries(
    settings.data.config,
    settings.data.revision,
    rules.data.rules,
    skills.data.skills
  ).filter(
    (entry) =>
      (filter === 'All' ||
        (filter === 'Always' ? entry.condition === null : entry.condition !== null)) &&
      [entry.name, entry.instruction, entry.condition ?? '']
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Search guidance" />
        <Button onClick={() => select(null)}>
          <PlusIcon className="size-4" />
          Add guidance
        </Button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div role="group" aria-label="Guidance type" className="flex gap-2">
            {(['All', 'Always', 'Situations'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'secondary' : 'ghost'}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value}
              </Button>
            ))}
          </div>
          <div className="divide-y rounded-xl border border-border/50 bg-card">
            {entries.length === 0 && (
              <p className="p-5 text-sm text-muted-foreground">No matching guidance.</p>
            )}
            {entries.map((entry) => (
              <div
                key={entry.key}
                className={`flex items-center gap-3 p-4 ${draft?.entry?.key === entry.key ? 'bg-muted/50' : ''}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.condition ?? 'Every conversation'}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {entry.uses.map((use) => (
                      <Badge key={use} variant="outline" size="sm">
                        {GUIDANCE_USE_LABELS[use]}
                      </Badge>
                    ))}
                    {!entry.uses.length && (
                      <Badge variant="outline" size="sm">
                        Not assigned
                      </Badge>
                    )}
                    {!entry.enabled && (
                      <Badge variant="secondary" size="sm">
                        Disabled
                      </Badge>
                    )}
                    {entry.source === 'managed' && (
                      <Badge variant="secondary" size="sm">
                        Managed
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => select(entry)}>
                  {entry.source === 'managed' ? 'View' : 'Edit'}
                </Button>
              </div>
            ))}
          </div>
        </div>
        {draft ? (
          <section
            aria-label="Guidance editor"
            className="min-w-0 rounded-xl border border-border/50 bg-card p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold">
              {draft.entry ? 'Edit guidance' : 'Add guidance'}
            </h2>
            {draft && (
              <fieldset disabled={busy || managed} className="space-y-4 min-w-0">
                <div className="space-y-1.5">
                  <Label htmlFor="guidance-name">Name</Label>
                  <Input
                    id="guidance-name"
                    value={draft.name}
                    disabled={draft.entry?.source === 'voice'}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="guidance-application">Applies when</Label>
                  <select
                    id="guidance-application"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    value={draft.scenario ? 'scenario' : 'always'}
                    disabled={draft.entry?.source === 'voice' || draft.entry?.source === 'skill'}
                    onChange={(e) => change({ scenario: e.target.value === 'scenario' })}
                  >
                    <option value="always">Every conversation</option>
                    <option value="scenario">When a situation comes up</option>
                  </select>
                  {draft.scenario && (
                    <Input
                      aria-label="Situation"
                      value={draft.condition}
                      onChange={(e) => change({ condition: e.target.value })}
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="guidance-instruction">What should Quinn do?</Label>
                  <Textarea
                    id="guidance-instruction"
                    rows={9}
                    className="min-h-40"
                    value={draft.instruction}
                    onChange={(e) => change({ instruction: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="guidance-use">Uses</Label>
                  {!draft.entry ? (
                    <select
                      id="guidance-use"
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      value={draft.use}
                      onChange={(e) => change({ use: e.target.value as Draft['use'] })}
                    >
                      <option value="agent">Customer conversations</option>
                      <option value="copilot">Support teammates</option>
                    </select>
                  ) : (
                    <p className="text-sm">
                      {draft.entry.uses.map((use) => GUIDANCE_USE_LABELS[use]).join(', ') ||
                        'Not assigned'}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Existing scope is preserved. New guidance currently applies to one use.
                  </p>
                </div>
                {draft.entry?.source !== 'voice' && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="guidance-enabled">Enabled</Label>
                    <Switch
                      id="guidance-enabled"
                      checked={draft.enabled}
                      onCheckedChange={(enabled) => change({ enabled })}
                    />
                  </div>
                )}
              </fieldset>
            )}
            {managed && (
              <p className="text-xs text-muted-foreground">
                These instructions are managed by your deployment configuration.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {draft?.entry && ['skill', 'rule'].includes(draft.entry.source) && (
                <Button
                  variant="outline"
                  className="me-auto"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  Delete
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              {!managed && (
                <Button disabled={busy || !dirty} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Saved guidance takes effect immediately. Instructions cannot grant access to knowledge
              or actions.
            </p>
          </section>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
            Choose guidance to edit, or add instructions for a new situation.
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this guidance?"
        description="Quinn will stop using these instructions."
        confirmLabel="Delete"
        variant="destructive"
        isPending={busy}
        onConfirm={remove}
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard unsaved changes?"
        description="Your saved guidance will stay unchanged."
        confirmLabel="Discard changes"
        variant="destructive"
        onConfirm={() => {
          setDiscarding(false)
          if (pendingSelection) open(pendingSelection.entry)
          else setDraft(null)
          setPendingSelection(null)
        }}
      />
    </div>
  )
}
