/**
 * Guidance rules: short admin-authored directives prompt assembly folds in
 * alongside the assistant's system prompt (e.g. "always mention the refund
 * policy on billing questions"). Local `rules` state re-syncs from the query
 * on every fetch, so a create/update/delete/reorder shows instantly and then
 * settles once its invalidate-triggered refetch lands (mirrors the
 * changelog labels card's optimistic list idiom, sourced from a query here
 * instead of a loader-seeded prop).
 */
import { useEffect, useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { CheckboxGroup } from '@/components/ui/checkbox-group'
import { CollapsibleSection } from '@/components/ui/collapsible'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import { ASSISTANT_SURFACES, ASSISTANT_SURFACE_LABELS } from '@/lib/shared/assistant/surfaces'
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import {
  ASSISTANT_GUIDANCE_CATEGORIES,
  ASSISTANT_GUIDANCE_CATEGORY_LABELS,
} from '@/lib/shared/assistant/guidance-categories'
import type { AssistantGuidanceCategory } from '@/lib/shared/assistant/guidance-categories'
import type { AssistantGuidanceRule } from '@/lib/server/domains/assistant/guidance.service'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  useCreateGuidanceRule,
  useUpdateGuidanceRule,
  useDeleteGuidanceRule,
  useReorderGuidanceRules,
} from '@/lib/client/mutations/assistant'
import { pct, asRate } from './metric-tile'

const TITLE_MAX = 80
const BODY_MAX = 1000
// Mirrors guidance.service.ts's GUIDANCE_CHAR_BUDGET; the query response is
// the authoritative value, this is only the pre-load fallback.
const FALLBACK_CHAR_BUDGET = 4000

const KNOWN_SURFACES: readonly string[] = ASSISTANT_SURFACES

// The column is a plain text[] (validated at the service layer, not typed at
// the schema layer), so a stored value is narrowed here rather than trusted.
function toKnownSurfaces(surfaces: AssistantGuidanceRule['surfaces']): AssistantSurface[] {
  return (surfaces ?? []).filter((s): s is AssistantSurface => KNOWN_SURFACES.includes(s))
}

function surfaceLabel(surfaces: AssistantGuidanceRule['surfaces']): string {
  const known = toKnownSurfaces(surfaces)
  if (known.length === 0) return 'All surfaces'
  return known.map((s) => ASSISTANT_SURFACE_LABELS[s].label).join(', ')
}

const KNOWN_CATEGORIES: readonly string[] = ASSISTANT_GUIDANCE_CATEGORIES

// The column is a plain text field (validated at the service layer), so a
// stored value is narrowed here rather than trusted; an unrecognized value
// (e.g. a category retired from the catalogue) buckets under "Other".
function toKnownCategory(category: AssistantGuidanceRule['category']): AssistantGuidanceCategory {
  return KNOWN_CATEGORIES.includes(category) ? (category as AssistantGuidanceCategory) : 'other'
}

export function GuidanceRulesCard() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const rulesQuery = useQuery(assistantQueries.guidanceRules())
  const statsQuery = useQuery(assistantQueries.guidanceRuleStats())
  const [rules, setRules] = useState<AssistantGuidanceRule[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AssistantGuidanceRule | null>(null)
  // Category a new rule (editingRule === null) opens the dialog pre-selected
  // to, set by the section whose "+ New" button was clicked.
  const [newRuleCategory, setNewRuleCategory] = useState<AssistantGuidanceCategory>('other')
  const [deletingRule, setDeletingRule] = useState<AssistantGuidanceRule | null>(null)
  const [reordering, setReordering] = useState(false)

  // Re-sync from the query's latest fetch (initial load and after every
  // mutation's invalidate) while local handlers below apply optimistic edits
  // in between.
  useEffect(() => {
    if (rulesQuery.data) setRules(rulesQuery.data.rules)
  }, [rulesQuery.data])

  const charBudget = rulesQuery.data?.charBudget ?? FALLBACK_CHAR_BUDGET
  const enabledChars = rules.filter((r) => r.enabled).reduce((sum, r) => sum + r.body.length, 0)

  // Grouped for display only — each rule keeps its index in the flat, position-
  // ordered `rules` array so reorder (which is not category-aware) still moves
  // the underlying list correctly.
  const rulesByCategory = ASSISTANT_GUIDANCE_CATEGORIES.map((category) => ({
    category,
    rules: rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => toKnownCategory(rule.category) === category),
  }))

  function openAddDialog(category: AssistantGuidanceCategory) {
    setEditingRule(null)
    setNewRuleCategory(category)
    setDialogOpen(true)
  }

  const createRule = useCreateGuidanceRule()
  const updateRule = useUpdateGuidanceRule()
  const deleteRule = useDeleteGuidanceRule()
  const reorderRules = useReorderGuidanceRules()

  async function handleToggleEnabled(rule: AssistantGuidanceRule) {
    const next = !rule.enabled
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)))
    try {
      await updateRule.mutateAsync({ id: rule.id, enabled: next })
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update guidance rule')
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)))
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    setRules(next)
    setReordering(true)
    try {
      await reorderRules.mutateAsync(next.map((r) => r.id))
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder guidance rules')
      setRules(rules)
    } finally {
      setReordering(false)
    }
  }

  async function handleDelete() {
    if (!deletingRule) return
    try {
      await deleteRule.mutateAsync(deletingRule.id)
      setRules((prev) => prev.filter((r) => r.id !== deletingRule.id))
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete guidance rule')
    } finally {
      setDeletingRule(null)
    }
  }

  async function handleSave(input: {
    title: string
    body: string
    enabled: boolean
    surfaces: AssistantSurface[] | null
    category: AssistantGuidanceCategory
  }) {
    if (editingRule) {
      const saved = await updateRule.mutateAsync({ id: editingRule.id, ...input })
      setRules((prev) =>
        prev.map((r) => (r.id === editingRule.id ? (saved ?? { ...r, ...input }) : r))
      )
    } else {
      const saved = await createRule.mutateAsync(input)
      setRules((prev) => [...prev, saved])
    }
    startTransition(() => router.invalidate())
  }

  return (
    <div className="space-y-8">
      <SettingsCard
        title="Guidance rules"
        description="Short directives the assistant folds into its prompt, such as always mentioning your refund policy on billing questions."
        contentClassName="p-4"
      >
        <div className="space-y-1">
          {rulesByCategory.map(({ category, rules: groupRules }) => (
            <div key={category} data-testid={`guidance-category-${category}`}>
              <CollapsibleSection
                title={ASSISTANT_GUIDANCE_CATEGORY_LABELS[category].label}
                description={ASSISTANT_GUIDANCE_CATEGORY_LABELS[category].description}
                defaultOpen
                headerClassName="px-2 py-2"
                contentClassName="px-0 pb-2 pt-0"
                headerAction={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-muted-foreground"
                    onClick={() => openAddDialog(category)}
                  >
                    <PlusIcon className="h-3 w-3" />
                    New
                  </Button>
                }
              >
                {groupRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No rules in this category yet.
                  </p>
                ) : (
                  groupRules.map(({ rule, index }) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
                    >
                      <div className="flex flex-col -my-1">
                        <button
                          type="button"
                          className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
                          onClick={() => move(index, -1)}
                          disabled={index === 0 || reordering}
                          aria-label={`Move ${rule.title} up`}
                        >
                          <ChevronUpIcon className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
                          onClick={() => move(index, 1)}
                          disabled={index === rules.length - 1 || reordering}
                          aria-label={`Move ${rule.title} down`}
                        >
                          <ChevronDownIcon className="h-3 w-3" />
                        </button>
                      </div>

                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => handleToggleEnabled(rule)}
                        className="scale-90"
                        aria-label={`Enable ${rule.title}`}
                      />

                      <span className="text-sm font-medium truncate">{rule.title}</span>

                      <Badge variant="outline" className="shrink-0">
                        {surfaceLabel(rule.surfaces)}
                      </Badge>

                      <span className="flex-1" />

                      <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums sm:flex">
                        <span title="Turns this rule was folded into the assistant's prompt">
                          {statsQuery.data?.[rule.id] ? statsQuery.data[rule.id].used : '—'} used
                        </span>
                        <span title="Share of those conversations that resolved">
                          {pct(asRate(statsQuery.data?.[rule.id]?.resolvedPct))} resolved
                        </span>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          setEditingRule(rule)
                          setDialogOpen(true)
                        }}
                        title="Edit guidance rule"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                        onClick={() => setDeletingRule(rule)}
                        title="Delete guidance rule"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </CollapsibleSection>
            </div>
          ))}

          <p className="text-xs text-muted-foreground pt-2 flex items-center gap-1">
            {enabledChars} / {charBudget} characters used across enabled rules
            {reordering && <ArrowPathIcon className="h-3 w-3 animate-spin ms-1" />}
          </p>
        </div>
      </SettingsCard>

      <GuidanceRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
        defaultCategory={newRuleCategory}
        enabledCharsExcludingSelf={
          enabledChars - (editingRule?.enabled ? editingRule.body.length : 0)
        }
        charBudget={charBudget}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!deletingRule}
        onOpenChange={() => setDeletingRule(null)}
        title="Delete guidance rule"
        description={`Are you sure you want to delete "${deletingRule?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

interface GuidanceRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: AssistantGuidanceRule | null
  /** Category a new rule (rule === null) opens pre-selected to; ignored when editing. */
  defaultCategory: AssistantGuidanceCategory
  /** Chars already committed by other enabled rules, for the live budget meter. */
  enabledCharsExcludingSelf: number
  charBudget: number
  onSave: (input: {
    title: string
    body: string
    enabled: boolean
    surfaces: AssistantSurface[] | null
    category: AssistantGuidanceCategory
  }) => Promise<void>
}

function GuidanceRuleDialog({
  open,
  onOpenChange,
  rule,
  defaultCategory,
  enabledCharsExcludingSelf,
  charBudget,
  onSave,
}: GuidanceRuleDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [surfaces, setSurfaces] = useState<AssistantSurface[]>([])
  const [category, setCategory] = useState<AssistantGuidanceCategory>('other')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEdit = rule !== null

  useEffect(() => {
    if (open) {
      setTitle(rule?.title ?? '')
      setBody(rule?.body ?? '')
      setEnabled(rule?.enabled ?? true)
      setSurfaces(toKnownSurfaces(rule?.surfaces ?? null))
      setCategory(rule ? toKnownCategory(rule.category) : defaultCategory)
      setError(null)
    }
  }, [open, rule, defaultCategory])

  const liveTotal = enabledCharsExcludingSelf + (enabled ? body.length : 0)
  const overBudget = liveTotal > charBudget

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedTitle = title.trim()
    const trimmedBody = body.trim()
    if (!trimmedTitle) {
      setError('Title is required')
      return
    }
    if (!trimmedBody) {
      setError('Body is required')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      await onSave({
        title: trimmedTitle,
        body: trimmedBody,
        enabled,
        surfaces: surfaces.length > 0 ? surfaces : null,
        category,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save guidance rule')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit guidance rule' : 'Add guidance rule'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guidance-title">Title</Label>
            <Input
              id="guidance-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Refund policy"
              maxLength={TITLE_MAX}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="guidance-category">Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as AssistantGuidanceCategory)}
            >
              <SelectTrigger id="guidance-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSISTANT_GUIDANCE_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ASSISTANT_GUIDANCE_CATEGORY_LABELS[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="guidance-body">Instructions</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {body.length} / {BODY_MAX}
              </span>
            </div>
            <Textarea
              id="guidance-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="e.g. Always mention our 30-day refund policy on billing questions."
              maxLength={BODY_MAX}
              rows={4}
              required
            />
            <p className={cn('text-xs', overBudget ? 'text-destructive' : 'text-muted-foreground')}>
              {liveTotal} / {charBudget} characters used across enabled rules
              {overBudget && '. Over budget: the assistant may drop lower-priority rules.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="cursor-pointer" htmlFor="guidance-enabled">
              Enabled
            </Label>
            <div className="flex items-center gap-2">
              <Switch id="guidance-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-xs text-muted-foreground">
                Off rules are saved but never folded into the prompt.
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Surfaces</Label>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to apply this rule everywhere the assistant speaks.
            </p>
            <CheckboxGroup
              items={ASSISTANT_SURFACES.map((surface) => ({
                value: surface,
                label: ASSISTANT_SURFACE_LABELS[surface].label,
                description: ASSISTANT_SURFACE_LABELS[surface].description,
              }))}
              selected={surfaces}
              onToggle={(value) => {
                const surface = value as AssistantSurface
                setSurfaces((prev) =>
                  prev.includes(surface) ? prev.filter((s) => s !== surface) : [...prev, surface]
                )
              }}
              className="space-y-2"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim() || !body.trim()}>
              {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Add rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
