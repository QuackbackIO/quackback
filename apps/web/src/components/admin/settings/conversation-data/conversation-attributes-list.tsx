/**
 * Conversation attributes registry manager (Settings > Conversation data >
 * Attributes). Mirrors the person-attributes list idioms: row list inside a
 * SettingsCard, one form dialog reused for create + edit. Registry semantics
 * enforced here in the form: key and field type lock after creation, select
 * options can be renamed or appended but never removed (values store option
 * ids), lifecycle is archive/restore only.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { PlusIcon, PencilIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { ArchiveBoxIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationAttributeId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  createConversationAttributeFn,
  updateConversationAttributeFn,
  archiveConversationAttributeFn,
  restoreConversationAttributeFn,
  previewAttributeDetectionFn,
  draftAttributeDescriptionsFn,
} from '@/lib/server/functions/conversation-attributes'
import {
  conversationAttributeQueries,
  type ConversationAttributeItem,
} from '@/lib/client/queries/conversation-attributes'
import { cn } from '@/lib/shared/utils'

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
] as const

type FieldType = (typeof FIELD_TYPES)[number]['value']

const TYPE_BADGE_COLORS: Record<FieldType, string> = {
  text: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  number: 'bg-green-500/10 text-green-500 border-green-500/20',
  select: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  multi_select: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  checkbox: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  date: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
}

const SOURCE_HINTS = [
  { value: 'agent', label: 'Agent' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'ai', label: 'AI' },
] as const

const isSelectType = (t: FieldType) => t === 'select' || t === 'multi_select'

/** AI detection is select-only (enforced again at the service layer) — both
 *  competitors we benchmarked against (Intercom Fin, Featurebase Fibi) are
 *  enum-only too; multi_select is a possible future extension, not v1. */
const supportsAiDetect = (t: FieldType) => t === 'select'

/** Heuristic only: flags the common "Other/Uncategorized/Fallback" catch-all
 *  patterns so classification doesn't come back empty on non-exhaustive
 *  taxonomies. Doesn't attempt to detect genuinely exhaustive sets. */
const OTHER_FALLBACK_PATTERN = /other|uncategori[sz]ed|fallback/i

interface OptionDraft {
  /** Present for saved options (rename-only); absent for a newly added one. */
  id?: string
  label: string
  description: string
}

interface AttributeFormValues {
  key: string
  label: string
  description: string
  fieldType: FieldType
  options: OptionDraft[]
  requiredToClose: boolean
  sourceHint: string
  aiDetect: boolean
  detectOnClose: boolean
}

/**
 * Phase 3 monitoring: a compact per-option bar breakdown of detections over
 * the last 30 days (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3). Read-only —
 * drill-through to the filtered conversation list is deferred (no cheap
 * existing inbox-filter link for a custom attribute value to reuse yet; see
 * the Phase 4 surfacing gap in the spec).
 */
function AttributeValueCountsBreakdown({ attributeKey }: { attributeKey: string }) {
  const { data, isPending, isError } = useQuery(
    conversationAttributeQueries.valueCounts(attributeKey, 30)
  )

  if (isPending || isError || !data) return null

  const total = data.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="space-y-1.5 rounded-md border border-border/50 px-3 py-2">
      <p className="text-sm font-medium">Detections (last 30 days)</p>
      {total === 0 ? (
        <p className="text-[11px] text-muted-foreground">No conversations in this window yet.</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((c) => {
            const pct = Math.round((c.count / total) * 100)
            return (
              <div key={c.optionId ?? 'unset'} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground">{c.label}</span>
                  <span className="text-muted-foreground">{c.count}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-indigo-500/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AttributeFormDialog({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<AttributeFormValues> & { id?: ConversationAttributeId }
  onSubmit: (values: AttributeFormValues) => Promise<void>
  isPending?: boolean
}) {
  const isEditing = !!initialValues?.id

  const [key, setKey] = useState(initialValues?.key ?? '')
  const [label, setLabel] = useState(initialValues?.label ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [fieldType, setFieldType] = useState<FieldType>(initialValues?.fieldType ?? 'text')
  const [options, setOptions] = useState<OptionDraft[]>(initialValues?.options ?? [])
  const [requiredToClose, setRequiredToClose] = useState(initialValues?.requiredToClose ?? false)
  const [sourceHint, setSourceHint] = useState(initialValues?.sourceHint ?? 'none')
  const [aiDetect, setAiDetect] = useState(initialValues?.aiDetect ?? false)
  const [detectOnClose, setDetectOnClose] = useState(initialValues?.detectOnClose ?? false)
  const [otherHintDismissed, setOtherHintDismissed] = useState(false)
  const [sampleMessage, setSampleMessage] = useState('')
  const [previewResult, setPreviewResult] = useState<{
    optionId: string | null
    optionLabel: string | null
    reasoning: string
  } | null>(null)
  const [pendingDraft, setPendingDraft] = useState<{
    attributeDescription: string
    options: { label: string; description: string }[]
  } | null>(null)

  useEffect(() => {
    if (open) {
      setKey(initialValues?.key ?? '')
      setLabel(initialValues?.label ?? '')
      setDescription(initialValues?.description ?? '')
      setFieldType(initialValues?.fieldType ?? 'text')
      setOptions(initialValues?.options ?? [])
      setRequiredToClose(initialValues?.requiredToClose ?? false)
      setSourceHint(initialValues?.sourceHint ?? 'none')
      setAiDetect(initialValues?.aiDetect ?? false)
      setDetectOnClose(initialValues?.detectOnClose ?? false)
      setOtherHintDismissed(false)
      setSampleMessage('')
      setPreviewResult(null)
      setPendingDraft(null)
    }
  }, [open])

  // AI detection is select-only: clear it if the author switches away from
  // select (only reachable pre-creation, since type locks after that).
  useEffect(() => {
    if (!supportsAiDetect(fieldType)) {
      setAiDetect(false)
      setDetectOnClose(false)
    }
  }, [fieldType])

  const updateOption = (index: number, patch: Partial<OptionDraft>) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)))

  const filledOptions = options.filter((o) => o.label.trim().length > 0)

  const draftDescriptions = useMutation({
    mutationFn: (input: Parameters<typeof draftAttributeDescriptionsFn>[0]['data']) =>
      draftAttributeDescriptionsFn({ data: input }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to draft descriptions'),
  })
  const previewDetection = useMutation({
    mutationFn: (input: Parameters<typeof previewAttributeDetectionFn>[0]['data']) =>
      previewAttributeDetectionFn({ data: input }),
    onSuccess: setPreviewResult,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to test detection'),
  })

  /** Fills description + per-option descriptions from a draft result, matching
   *  options by their (trimmed) label — only filled options are touched. */
  const applyDraft = (draft: {
    attributeDescription: string
    options: { label: string; description: string }[]
  }) => {
    setDescription(draft.attributeDescription)
    setOptions((prev) =>
      prev.map((o) => {
        const trimmed = o.label.trim()
        if (!trimmed) return o
        const match = draft.options.find((r) => r.label === trimmed)
        return match ? { ...o, description: match.description } : o
      })
    )
  }

  const handleDraftDescriptions = async () => {
    if (filledOptions.length === 0) return
    const draft = await draftDescriptions.mutateAsync({
      label: label.trim() || 'Untitled attribute',
      optionLabels: filledOptions.map((o) => o.label.trim()),
    })
    const hasExisting =
      description.trim().length > 0 || filledOptions.some((o) => o.description.trim().length > 0)
    if (hasExisting) {
      setPendingDraft(draft)
    } else {
      applyDraft(draft)
    }
  }

  const handleTestDetection = async () => {
    if (!sampleMessage.trim() || filledOptions.length === 0) return
    await previewDetection.mutateAsync({
      definition: {
        key: key.trim() || undefined,
        label: label.trim() || 'Untitled attribute',
        description: description.trim() || undefined,
        options: filledOptions.map((o) => ({
          id: o.id,
          label: o.label.trim(),
          description: o.description.trim() || undefined,
        })),
      },
      sampleMessage,
    })
  }
  const hasOtherFallback = filledOptions.some((o) => OTHER_FALLBACK_PATTERN.test(o.label))
  const showOtherHint =
    aiDetect && supportsAiDetect(fieldType) && !hasOtherFallback && !otherHintDismissed
  const canSubmit =
    key.trim().length > 0 &&
    label.trim().length > 0 &&
    (!isSelectType(fieldType) || filledOptions.length > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      key,
      label,
      description,
      fieldType,
      options: isSelectType(fieldType) ? filledOptions : [],
      requiredToClose,
      sourceHint,
      aiDetect: supportsAiDetect(fieldType) ? aiDetect : false,
      detectOnClose: supportsAiDetect(fieldType) ? aiDetect && detectOnClose : false,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit attribute' : 'New conversation attribute'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conv-attr-key">Key</Label>
            <Input
              id="conv-attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="issue_type"
              disabled={isEditing}
              className={isEditing ? 'bg-muted text-muted-foreground' : ''}
              required
            />
            {!isEditing && (
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, underscores only. Cannot be changed after creation.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conv-attr-label">Display label</Label>
            <Input
              id="conv-attr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Issue type"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={fieldType}
              onValueChange={(v) => setFieldType(v as FieldType)}
              disabled={isEditing}
            >
              <SelectTrigger className={isEditing ? 'bg-muted text-muted-foreground' : ''}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEditing && (
              <p className="text-[11px] text-muted-foreground">The type is fixed after creation.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conv-attr-desc">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="conv-attr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this attribute captures. Also guides AI detection."
              rows={2}
              className="resize-none text-sm"
            />
            {aiDetect && supportsAiDetect(fieldType) && (
              <p className="text-[11px] text-muted-foreground">
                This is the whole prompt Quinn sees, so be explicit: when the value applies, when it
                does not, and typical customer phrasing. Example: &quot;Applies when the customer
                reports being charged the wrong amount. Does not apply to general billing questions.
                Customers usually say things like &apos;double charged&apos; or &apos;wrong
                price&apos;.&quot;
              </p>
            )}
          </div>

          {isSelectType(fieldType) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Options</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  disabled={filledOptions.length === 0 || draftDescriptions.isPending}
                  onClick={handleDraftDescriptions}
                  title="Fill descriptions from the option labels using AI"
                >
                  <SparklesIcon className="h-3 w-3" />
                  {draftDescriptions.isPending ? 'Drafting...' : 'Draft descriptions'}
                </Button>
              </div>
              {pendingDraft && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-500">
                    This will overwrite existing descriptions.
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        applyDraft(pendingDraft)
                        setPendingDraft(null)
                      }}
                    >
                      Overwrite
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setPendingDraft(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {options.map((option, i) => (
                  <div key={option.id ?? `new-${i}`} className="flex items-start gap-1.5">
                    <div className="flex-1 space-y-1">
                      <Input
                        value={option.label}
                        onChange={(e) => updateOption(i, { label: e.target.value })}
                        placeholder="Option label"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={option.description}
                        onChange={(e) => updateOption(i, { description: e.target.value })}
                        placeholder="Description (optional, guides AI detection)"
                        className="h-8 text-xs"
                      />
                    </div>
                    {/* Saved options can only be renamed: stored values
                        reference their ids, so removal is not offered. */}
                    {option.id === undefined && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                        title="Remove option"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setOptions((prev) => [...prev, { label: '', description: '' }])}
                >
                  <PlusIcon className="h-3 w-3" /> Add option
                </Button>
              </div>
              {isEditing && (
                <p className="text-[11px] text-muted-foreground">
                  Existing options can be renamed but not removed, because stored values reference
                  them.
                </p>
              )}
              {showOtherHint && (
                <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-500">
                    Consider adding an &quot;Other&quot; or &quot;Uncategorized&quot; option so
                    classification never comes back empty when nothing else fits.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 shrink-0 px-1 text-amber-700 hover:text-amber-800 dark:text-amber-500"
                    onClick={() => setOtherHintDismissed(true)}
                    title="Dismiss"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {supportsAiDetect(fieldType) && (
            <div className="space-y-2 rounded-md border border-border/50 px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Let AI detect this attribute</p>
                  <p className="text-[11px] text-muted-foreground">
                    Quinn classifies conversations it participates in.
                  </p>
                </div>
                <Switch checked={aiDetect} onCheckedChange={setAiDetect} />
              </div>
              {aiDetect && (
                <div className="flex items-center justify-between border-t border-border/50 pt-2">
                  <div>
                    <p className="text-sm font-medium">Re-check on close</p>
                    <p className="text-[11px] text-muted-foreground">
                      Runs once more when a teammate closes the conversation.
                    </p>
                  </div>
                  <Switch checked={detectOnClose} onCheckedChange={setDetectOnClose} />
                </div>
              )}
            </div>
          )}

          {aiDetect && supportsAiDetect(fieldType) && (
            <div className="space-y-2 rounded-md border border-border/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Test detection</p>
                <p className="text-[11px] text-muted-foreground">
                  Paste a sample customer message to preview what Quinn would detect.
                </p>
              </div>
              <Textarea
                value={sampleMessage}
                onChange={(e) => setSampleMessage(e.target.value)}
                placeholder="e.g. I was charged twice for my subscription this month."
                rows={2}
                className="resize-none text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={
                  !sampleMessage.trim() || filledOptions.length === 0 || previewDetection.isPending
                }
                onClick={handleTestDetection}
              >
                <SparklesIcon className="h-3 w-3" />
                {previewDetection.isPending ? 'Testing...' : 'Test detection'}
              </Button>
              {previewResult && (
                <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs">
                  <p className="font-medium text-foreground">
                    {previewResult.optionLabel ?? 'No option applies'}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{previewResult.reasoning}</p>
                </div>
              )}
            </div>
          )}

          {isEditing && initialValues?.aiDetect && initialValues?.key && (
            <AttributeValueCountsBreakdown attributeKey={initialValues.key} />
          )}

          <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Required to close</p>
              <p className="text-[11px] text-muted-foreground">
                Teammates must fill this before closing a conversation. Automations are exempt.
              </p>
            </div>
            <Switch checked={requiredToClose} onCheckedChange={setRequiredToClose} />
          </div>

          <div className="space-y-1.5">
            <Label>
              Usually set by <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select value={sourceHint} onValueChange={setSourceHint}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No hint</SelectItem>
                {SOURCE_HINTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? 'Saving...' : isEditing ? 'Save changes' : 'Create attribute'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AttributeRow({
  attribute,
  onEdit,
  onArchive,
  onRestore,
}: {
  attribute: ConversationAttributeItem
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
}) {
  const archived = !!attribute.archivedAt
  const typeInfo = FIELD_TYPES.find((t) => t.value === attribute.fieldType)

  return (
    <div
      className={cn(
        'flex items-center gap-4 py-3 border-b border-border/50 last:border-0',
        archived && 'opacity-60'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{attribute.label}</span>
          <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            {attribute.key}
          </code>
          <span
            className={cn(
              'inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border',
              TYPE_BADGE_COLORS[attribute.fieldType as FieldType]
            )}
          >
            {typeInfo?.label ?? attribute.fieldType}
          </span>
          {attribute.sourceHint && (
            <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border/50 capitalize">
              {attribute.sourceHint}
            </span>
          )}
          {attribute.aiDetect && (
            <span
              className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
              title={
                attribute.detectOnClose
                  ? 'Quinn classifies this attribute and re-checks on close'
                  : 'Quinn classifies this attribute'
              }
            >
              AI
            </span>
          )}
          {attribute.requiredToClose && (
            <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-600 border-amber-500/20">
              Required to close
            </span>
          )}
          {archived && (
            <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border/50">
              Archived
            </span>
          )}
        </div>
        {attribute.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{attribute.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {archived ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onRestore}
            title="Restore attribute"
          >
            <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Restore
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              title="Edit attribute"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
              onClick={onArchive}
              title="Archive attribute"
            >
              <ArchiveBoxIcon className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export function ConversationAttributesList() {
  const queryClient = useQueryClient()
  const registryQuery = useSuspenseQuery(conversationAttributeQueries.registry())
  const attributes = registryQuery.data

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'conversation-attributes'] })

  const createAttr = useMutation({
    mutationFn: (input: Parameters<typeof createConversationAttributeFn>[0]['data']) =>
      createConversationAttributeFn({ data: input }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create attribute'),
  })
  const updateAttr = useMutation({
    mutationFn: (input: Parameters<typeof updateConversationAttributeFn>[0]['data']) =>
      updateConversationAttributeFn({ data: input }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update attribute'),
  })
  const archiveAttr = useMutation({
    mutationFn: (id: ConversationAttributeId) => archiveConversationAttributeFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to archive attribute'),
  })
  const restoreAttr = useMutation({
    mutationFn: (id: ConversationAttributeId) => restoreConversationAttributeFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to restore attribute'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ConversationAttributeItem | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ConversationAttributeItem | null>(null)

  const handleCreate = async (values: AttributeFormValues) => {
    await createAttr.mutateAsync({
      key: values.key,
      label: values.label,
      description: values.description || undefined,
      fieldType: values.fieldType,
      options: isSelectType(values.fieldType)
        ? values.options.map((o) => ({
            label: o.label.trim(),
            description: o.description.trim() || undefined,
          }))
        : undefined,
      requiredToClose: values.requiredToClose,
      sourceHint:
        values.sourceHint === 'none'
          ? undefined
          : (values.sourceHint as 'ai' | 'workflow' | 'agent'),
      aiDetect: values.aiDetect,
      detectOnClose: values.detectOnClose,
    })
    setCreateOpen(false)
  }

  const handleUpdate = async (values: AttributeFormValues) => {
    if (!editTarget) return
    await updateAttr.mutateAsync({
      id: editTarget.id,
      label: values.label,
      description: values.description || null,
      options: isSelectType(values.fieldType)
        ? values.options.map((o) => ({
            id: o.id,
            label: o.label.trim(),
            description: o.description.trim() || undefined,
          }))
        : undefined,
      requiredToClose: values.requiredToClose,
      sourceHint:
        values.sourceHint === 'none' ? null : (values.sourceHint as 'ai' | 'workflow' | 'agent'),
      aiDetect: values.aiDetect,
      detectOnClose: values.detectOnClose,
    })
    setEditTarget(null)
  }

  const handleArchive = async () => {
    if (!archiveTarget) return
    await archiveAttr.mutateAsync(archiveTarget.id)
    setArchiveTarget(null)
  }

  const live = attributes.filter((a) => !a.archivedAt)
  const archived = attributes.filter((a) => !!a.archivedAt)

  return (
    <SettingsCard
      title="Conversation attributes"
      description="Custom data attributes on conversations and tickets, editable in the inbox and settable by macros, workflows, and AI."
      action={
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          New attribute
        </Button>
      }
    >
      {attributes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No attributes yet. Create one to start capturing structured data on conversations.
        </p>
      ) : (
        <div>
          {[...live, ...archived].map((attr) => (
            <AttributeRow
              key={attr.id}
              attribute={attr}
              onEdit={() => setEditTarget(attr)}
              onArchive={() => setArchiveTarget(attr)}
              onRestore={() => restoreAttr.mutate(attr.id)}
            />
          ))}
        </div>
      )}

      <AttributeFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isPending={createAttr.isPending}
      />

      <AttributeFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={
          editTarget
            ? {
                id: editTarget.id,
                key: editTarget.key,
                label: editTarget.label,
                description: editTarget.description ?? '',
                fieldType: editTarget.fieldType as FieldType,
                options: (editTarget.options ?? []).map((o) => ({
                  id: o.id,
                  label: o.label,
                  description: o.description ?? '',
                })),
                requiredToClose: editTarget.requiredToClose,
                sourceHint: editTarget.sourceHint ?? 'none',
                aiDetect: editTarget.aiDetect,
                detectOnClose: editTarget.detectOnClose,
              }
            : undefined
        }
        onSubmit={handleUpdate}
        isPending={updateAttr.isPending}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive "${archiveTarget?.label}"?`}
        description="Archived attributes disappear from pickers and the inbox editor. Stored values are kept and the key stays reserved. You can restore it at any time."
        confirmLabel="Archive"
        isPending={archiveAttr.isPending}
        onConfirm={handleArchive}
      />
    </SettingsCard>
  )
}
