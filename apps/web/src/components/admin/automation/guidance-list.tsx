import { useState } from 'react'
import { ZodError } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/solid'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  useSaveGuidanceEntry,
  useDeleteGuidanceEntry,
  useUpdateAssistantVoice,
} from '@/lib/client/mutations/assistant'
import {
  guidanceEntryInputSchema,
  GUIDANCE_PROFILES,
  GUIDANCE_USE_LABELS,
  type GuidanceEntryDTO,
  type GuidanceEntryKind,
} from '@/lib/shared/assistant/guidance-entry'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'
import { ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH } from '@/lib/shared/assistant/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SearchInput } from '@/components/shared/search-input'
import { useUnsavedChanges } from './assistant-form'

interface Draft {
  entry: GuidanceEntryDTO | null
  title: string
  body: string
  condition: string
  kind: GuidanceEntryKind
  enabled: boolean
  uses: AssistantAgentKind[]
}

function newDraft(entry: GuidanceEntryDTO | null): Draft {
  return {
    entry,
    title: entry?.title ?? '',
    body: entry?.body ?? '',
    condition: entry?.appliesWhen ?? '',
    kind: entry?.kind ?? 'situational',
    enabled: entry?.enabled ?? true,
    uses: entry ? entry.uses : ['agent'],
  }
}

export function GuidanceList() {
  const settings = useQuery(assistantQueries.settings())
  const entries = useQuery(assistantQueries.guidanceEntries())
  const saveEntry = useSaveGuidanceEntry()
  const deleteEntry = useDeleteGuidanceEntry()
  const updateVoice = useUpdateAssistantVoice()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'All' | 'Always' | 'Situations'>('All')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initial, setInitial] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<{
    entry: GuidanceEntryDTO | null
  } | null>(null)
  const dirty = draft !== null && JSON.stringify(draft) !== initial
  useUnsavedChanges(dirty, 'guidance')
  const busy = [saveEntry, deleteEntry, updateVoice].some((mutation) => mutation.isPending)

  function open(entry: GuidanceEntryDTO | null) {
    const next = newDraft(entry)
    setDraft(next)
    setInitial(JSON.stringify(next))
    setError('')
  }
  function select(entry: GuidanceEntryDTO | null) {
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
  function toggleUse(use: AssistantAgentKind, checked: boolean) {
    setDraft((current) => {
      if (!current) return current
      const uses = checked
        ? GUIDANCE_PROFILES.filter((profile) => profile === use || current.uses.includes(profile))
        : current.uses.filter((profile) => profile !== use)
      return { ...current, uses }
    })
    setError('')
  }

  // The two config-owned entries are the assistant configuration's, not this
  // table's: the workspace's writing guidelines save through the config write
  // funnel with its revision check, and the managed workspace instructions are
  // pinned by the deployment and only shown here.
  const configOwned = draft?.entry?.owner === 'config'
  const readOnly = draft?.entry?.managed === true || draft?.entry?.legacySource === 'managed'

  async function save() {
    if (!draft || readOnly || busy) return
    setError('')
    try {
      const entry = draft.entry
      if (entry && entry.owner === 'config') {
        if (draft.body.length > ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH) {
          throw new Error(
            `Use ${ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString()} characters or fewer.`
          )
        }
        if (!settings.data) throw new Error('Settings are still loading. Try again in a moment.')
        await updateVoice.mutateAsync({
          expectedRevision: settings.data.revision,
          voice: {
            ...settings.data.config.agents.agent.voice,
            additionalInstructions: draft.body,
          },
        })
        await entries.refetch()
      } else {
        const value = guidanceEntryInputSchema.parse({
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          appliesWhen: draft.kind === 'always' ? null : draft.condition,
          enabled: draft.enabled,
          priority: entry?.priority ?? 0,
          uses: draft.uses,
        })
        await saveEntry.mutateAsync({
          ...(entry ? { id: entry.id, expectedVersion: entry.version } : {}),
          entry: value,
        })
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
    if (!draft?.entry || draft.entry.owner === 'config' || busy) return
    try {
      await deleteEntry.mutateAsync(draft.entry.id)
      setDeleting(false)
      setDraft(null)
    } catch (err) {
      setDeleting(false)
      setError(err instanceof Error ? err.message : 'Could not delete guidance.')
    }
  }

  if ((!settings.data || !entries.data) && (settings.isError || entries.isError))
    return (
      <div role="alert" className="space-y-3">
        <p>Guidance could not be loaded.</p>
        <Button
          variant="outline"
          onClick={() => {
            void settings.refetch()
            void entries.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  if (!settings.data || !entries.data) return <p role="status">Loading guidance…</p>

  const visible = entries.data.entries.filter(
    (entry) =>
      (filter === 'All' ||
        (filter === 'Always' ? entry.kind === 'always' : entry.kind !== 'always')) &&
      [entry.title, entry.body, entry.appliesWhen ?? '']
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
            {visible.length === 0 && (
              <p className="p-5 text-sm text-muted-foreground">No matching guidance.</p>
            )}
            {visible.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-center gap-3 p-4 ${draft?.entry?.id === entry.id ? 'bg-muted/50' : ''}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.appliesWhen ?? 'Every conversation'}
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
                    {entry.managed && (
                      <Badge variant="secondary" size="sm">
                        Managed
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => select(entry)}>
                  {entry.managed ? 'View' : 'Edit'}
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
            <fieldset disabled={busy || readOnly} className="space-y-4 min-w-0">
              <div className="space-y-1.5">
                <Label htmlFor="guidance-name">Name</Label>
                <Input
                  id="guidance-name"
                  value={draft.title}
                  disabled={configOwned}
                  onChange={(event) => change({ title: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                {draft.kind === 'procedure' ? (
                  <>
                    <Label htmlFor="guidance-when-to-use">When to use</Label>
                    <Input
                      id="guidance-when-to-use"
                      value={draft.condition}
                      onChange={(event) => change({ condition: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Quinn loads these steps on request.
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="guidance-application">Applies when</Label>
                    <Select
                      value={draft.kind}
                      onValueChange={(value) => change({ kind: value as GuidanceEntryKind })}
                      disabled={configOwned}
                    >
                      <SelectTrigger id="guidance-application">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="always">Every conversation</SelectItem>
                        <SelectItem value="situational">When a situation comes up</SelectItem>
                      </SelectContent>
                    </Select>
                    {draft.kind === 'situational' && (
                      <Input
                        aria-label="Situation"
                        value={draft.condition}
                        onChange={(event) => change({ condition: event.target.value })}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guidance-instruction">What should Quinn do?</Label>
                <Textarea
                  id="guidance-instruction"
                  rows={9}
                  className="min-h-40"
                  value={draft.body}
                  onChange={(event) => change({ body: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Uses</Label>
                {configOwned ? (
                  <p className="text-sm">
                    {draft.uses.map((use) => GUIDANCE_USE_LABELS[use]).join(', ')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {GUIDANCE_PROFILES.map((use) => (
                      <div key={use} className="flex items-center gap-2">
                        <Checkbox
                          id={`guidance-use-${use}`}
                          checked={draft.uses.includes(use)}
                          onCheckedChange={(checked) => toggleUse(use, checked === true)}
                        />
                        <Label htmlFor={`guidance-use-${use}`} className="font-normal">
                          {GUIDANCE_USE_LABELS[use]}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!configOwned && (
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
            {readOnly && (
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
              {draft.entry && draft.entry.owner === 'canonical' && (
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
              {!readOnly && (
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
