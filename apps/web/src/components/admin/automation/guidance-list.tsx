import { useRef, useState } from 'react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dirty = draft !== null && JSON.stringify(draft) !== initial
  useUnsavedChanges(dirty, 'guidance')
  const busy = [saveEntry, deleteEntry, updateVoice].some((mutation) => mutation.isPending)

  function open(entry: GuidanceEntryDTO | null) {
    const next = newDraft(entry)
    setDraft(next)
    setInitial(JSON.stringify(next))
    setError('')
  }
  function select(entry: GuidanceEntryDTO | null, trigger: HTMLButtonElement) {
    if (busy) return
    triggerRef.current = trigger
    open(entry)
  }
  function close() {
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
    if (!draft || readOnly || busy || !dirty || deleting || discarding) return
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

  const handleKeyDown = useKeyboardSubmit(() => void save())

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
        <Button onClick={(event) => select(null, event.currentTarget)}>
          <PlusIcon className="size-4" />
          Add guidance
        </Button>
      </div>
      <div className="space-y-3">
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
              <div key={entry.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium break-words">{entry.title}</p>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => select(entry, event.currentTarget)}
                >
                  {entry.managed ? 'View' : 'Edit'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Dialog
        open={draft !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) close()
        }}
      >
        {draft && (
          <DialogContent
            className="w-[95vw] max-w-3xl max-h-[85dvh] p-0 gap-0 overflow-hidden flex flex-col"
            finalFocus={triggerRef}
            onKeyDown={handleKeyDown}
            showCloseButton={!busy}
          >
            <DialogHeader className="border-b px-4 sm:px-6 py-4 pe-12 shrink-0">
              <DialogTitle>
                {readOnly ? 'View guidance' : draft.entry ? 'Edit guidance' : 'Add guidance'}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
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
                      <Label id="guidance-application">Applies when</Label>
                      <RadioGroup
                        aria-labelledby="guidance-application"
                        value={draft.kind}
                        onValueChange={(value) => change({ kind: value as GuidanceEntryKind })}
                        disabled={configOwned || busy || readOnly}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {(
                          [
                            ['always', 'Every conversation'],
                            ['situational', 'When a situation comes up'],
                          ] as const
                        ).map(([value, label]) => (
                          <Label
                            key={value}
                            htmlFor={`guidance-application-${value}`}
                            className={`flex items-center gap-3 rounded-lg border p-3 text-sm font-normal cursor-pointer ${draft.kind === value ? 'border-primary bg-primary/5' : 'border-border'}`}
                          >
                            <RadioGroupItem id={`guidance-application-${value}`} value={value} />
                            {label}
                          </Label>
                        ))}
                      </RadioGroup>
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
                    className="field-sizing-fixed min-h-48 max-h-[40dvh] resize-y"
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
              {!readOnly && dirty && (
                <p className="text-xs text-muted-foreground">
                  Saved guidance takes effect immediately.
                </p>
              )}
            </div>
            {readOnly ? (
              <div className="flex justify-end border-t px-4 sm:px-6 py-3 bg-muted/30 shrink-0">
                <Button variant="ghost" size="sm" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <ModalFooter
                onCancel={close}
                submitLabel={busy ? 'Saving…' : 'Save'}
                isPending={busy}
                submitDisabled={!dirty}
                submitType="button"
                onSubmit={() => void save()}
              >
                {draft.entry?.owner === 'canonical' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setDeleting(true)}
                  >
                    Delete
                  </Button>
                )}
              </ModalFooter>
            )}
          </DialogContent>
        )}
      </Dialog>
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
          setDraft(null)
        }}
      />
    </div>
  )
}
