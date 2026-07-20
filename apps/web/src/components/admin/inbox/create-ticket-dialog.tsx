import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { XMarkIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import type { ConversationId, PrincipalId, TicketId, TicketTypeId } from '@quackback/ids'
import type { TicketType, TiptapContent } from '@/lib/shared/db-types'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  validateTicketIntakeValues,
  type TicketIntakeError,
  type TicketTypeDTO,
} from '@/lib/shared/tickets'
import { useCreateTicket } from '@/lib/client/mutations/inbox'
import { ticketQueries } from '@/lib/client/queries/inbox'
import {
  linkTicketToConversationFn,
  suggestTicketFieldValuesFn,
} from '@/lib/server/functions/tickets'
import { ticketTypeLabel } from '@/components/admin/inbox/ticket-chips'
import { realEmail } from '@/lib/shared/anonymous-email'
import { PortalUserPicker } from '@/components/shared/portal-user-picker'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TicketFormFields } from '@/components/shared/ticket-form-fields'
import { CONVERSATION_EDITOR_FEATURES } from '@/components/conversation/conversation-editor-features'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Native `<textarea maxLength>` used to silently cap this field; a rich doc
// can't be truncated mid-node without corrupting it, so the cap is now
// enforced pre-submit with the same toast the dialog already uses for
// mutation errors.
const DESCRIPTION_MAX_LENGTH = 4000

interface Requester {
  principalId: string
  name: string | null
  email: string | null
  image?: string | null
}

export interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new ticket's id on success (both standalone and
   *  from-a-conversation flows) — the caller navigates to it. */
  onCreated: (ticketId: TicketId) => void
  /** Set when opened from a conversation (unified inbox §M5's create-ticket
   *  flow: header icon, the panel's Ticket card empty slot, or the command
   *  bar with a conversation active). Locks the type picker to the CUSTOMER
   *  category, fixes the requester to the conversation's visitor (no picker),
   *  and links the new ticket back to this conversation on success. */
  conversationId?: ConversationId
  /** Prefill from the conversation's subject or first message. Only read
   *  when `conversationId` is set (the standalone flow starts blank). */
  defaultTitle?: string
  /** The conversation's visitor, prefilled as the fixed requester. Only read
   *  when `conversationId` is set. */
  defaultRequester?: Requester | null
  /** Refresh the caller's lists/thread after a successful create (+ link) —
   *  the conversation thread gains a system note announcing the ticket. */
  onChanged?: () => void
}

/** The create-dialog preselection: the customer category's default type, else
 *  the first candidate (a workspace whose customer types are all archived). */
function preselectedType(candidates: TicketTypeDTO[]): TicketTypeDTO | null {
  return (
    candidates.find((t) => t.category === 'customer' && t.isDefault) ??
    candidates.find((t) => t.category === 'customer') ??
    candidates[0] ??
    null
  )
}

/**
 * Open a ticket. Standalone (no `conversationId`): pick a type + title, and
 * optionally attach a requester — the general-purpose flow (command bar with
 * no conversation active, or the pre-unified tickets page). From a
 * conversation (`conversationId` set): the picker is limited to CUSTOMER
 * types, the requester is fixed to the conversation's visitor, and a
 * successful create links the ticket back to the conversation
 * (`linkTicketToConversationFn`) — a friendly conflict (one customer ticket
 * per conversation, already linked) still counts as "created", just not
 * (re-)linked.
 *
 * CONVERGENCE PHASE 4: the type picker lists the workspace's registry types;
 * the chosen type drives the category (derived server-side) and swaps the
 * dynamic field set rendered from its `fields[]`, validated into
 * `customAttributes` on submit. A workspace with no live registry types keeps
 * the legacy bare-category picker.
 *
 * CONVERGENCE PHASE 5 (copilot auto-fill, suggestion-only): from a
 * conversation with the workspace's AI enabled and a type selected, an
 * "✨ Auto-fill" button (next to the type picker — an explicit action, not an
 * auto-trigger on type selection: the dialog's pattern is explicit submits,
 * and an AI call per swap would spend tokens without intent) asks
 * `suggestTicketFieldValuesFn` for the type's fields + the title. Suggested
 * values pre-fill with a "✨ suggested" marker (a header badge counts them)
 * and stay editable; unanswered fields stay empty with a muted "not
 * suggested" state; "Undo suggestions" restores the exact pre-suggestion
 * form. Nothing writes until the normal submit — the save path re-validates
 * everything server-side. AI disabled/unconfigured, an empty thread, or a
 * failed/flaky completion → the quiet fallback: the plain Phase-4 form
 * unchanged, never half-filled.
 */
export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
  conversationId,
  defaultTitle,
  defaultRequester,
  onChanged,
}: CreateTicketDialogProps) {
  const fromConversation = !!conversationId
  const [type, setType] = useState<TicketType>('customer')
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [descriptionJson, setDescriptionJson] = useState<JSONContent | undefined>(undefined)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('')
  const [requester, setRequester] = useState<Requester | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // CONVERGENCE PHASE 5 — copilot auto-fill (suggestion-only). `suggestedKeys`
  // marks which values currently on the form came from the copilot (the
  // provenance marker); `preSuggestion` is the form snapshot "Undo
  // suggestions" restores; `autoFillHidden` retires the affordance for this
  // dialog session once the server says suggestions are unavailable (AI
  // unconfigured, empty thread, a flaky structured-output completion).
  const [autoFillLoading, setAutoFillLoading] = useState(false)
  const [autoFillHidden, setAutoFillHidden] = useState(false)
  const [suggestedKeys, setSuggestedKeys] = useState<ReadonlySet<string>>(new Set())
  const [preSuggestion, setPreSuggestion] = useState<{
    title: string
    fieldValues: Record<string, unknown>
  } | null>(null)

  // The client-visible half of the AI gate (the same route-context flag the
  // Copilot tab reads): the flag off hides the affordance outright. The
  // server half (assistant configured, budget, non-empty thread) surfaces as
  // the fn's `unavailable` response, which retires the button below.
  const { settings } = useRouteContext({ from: '/admin' }) as {
    settings?: { featureFlags?: FeatureFlags } | null
  }
  const showAutoFill =
    fromConversation &&
    selectedTypeId !== null &&
    !!settings?.featureFlags?.inboxAi &&
    !autoFillHidden

  // The registry types the picker offers (live rows only). From a conversation
  // the pair rule locks the category to customer, so the picker does too.
  const { data: registryTypes } = useQuery(ticketQueries.types())
  const candidates = useMemo(() => {
    const live = (registryTypes ?? []).filter((t) => !t.archived)
    return fromConversation ? live.filter((t) => t.category === 'customer') : live
  }, [registryTypes, fromConversation])
  const selectedType = candidates.find((t) => t.id === selectedTypeId) ?? null
  const selectedFields = useMemo(
    () => [...(selectedType?.fields ?? [])].sort((a, b) => a.order - b.order),
    [selectedType]
  )

  // A fresh open starts clean — prefilled from the conversation when opened
  // in that mode, with the category default type preselected. `candidates` is
  // intentionally read at open time only — a mid-dialog registry refresh must
  // not yank the agent's selection (the follow-up effect below only applies
  // the preselection while nothing is selected).
  useEffect(() => {
    if (open) {
      setType('customer')
      setSelectedTypeId(preselectedType(candidates)?.id ?? null)
      setTitle(fromConversation ? (defaultTitle ?? '') : '')
      setDescriptionJson(undefined)
      setDescriptionMarkdown('')
      setRequester(fromConversation ? (defaultRequester ?? null) : null)
      setFieldValues({})
      setFieldErrors({})
      setAutoFillLoading(false)
      setAutoFillHidden(false)
      setSuggestedKeys(new Set())
      setPreSuggestion(null)
    }
  }, [open, fromConversation, defaultTitle, defaultRequester])

  // The types query is async: when the dialog opens before the registry has
  // arrived, preselect as soon as it lands (only while nothing is selected —
  // an agent's own pick is never overridden).
  useEffect(() => {
    if (open && selectedTypeId === null && candidates.length > 0) {
      setSelectedTypeId(preselectedType(candidates)?.id ?? null)
    }
  }, [open, candidates, selectedTypeId])

  const create = useCreateTicket()
  const { upload: uploadImage } = useImageUpload({ prefix: 'chat-images' })
  const [linking, setLinking] = useState(false)
  const canCreate = title.trim().length > 0 && !create.isPending && !linking

  /** Type swap: change the field set and drop the old type's answers (the
   *  retype rule protects STORED answers, not a draft's stale keys). Any
   *  suggestion state dies with the old type's field set too. */
  const selectType = (id: string) => {
    setSelectedTypeId(id)
    setFieldValues({})
    setFieldErrors({})
    setSuggestedKeys(new Set())
    setPreSuggestion(null)
  }

  const setFieldValue = (key: string, value: unknown) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  /**
   * "✨ Auto-fill" (Phase 5): ONE structured-completion call suggests the
   * chosen type's fields + the title from the conversation. Suggestion-only —
   * values pre-fill marked and stay editable; nothing writes until the normal
   * submit. A button, not an auto-trigger on type selection: the dialog's
   * pattern is explicit actions, and an AI call on every type swap would
   * spend tokens without intent. Every failure mode (unavailable, error,
   * empty result) leaves the form exactly as it was — never half-filled.
   */
  const runAutoFill = async () => {
    if (!conversationId || !selectedTypeId || autoFillLoading) return
    setAutoFillLoading(true)
    try {
      const result = await suggestTicketFieldValuesFn({
        data: { conversationId, ticketTypeId: selectedTypeId as TicketTypeId },
      })
      const suggestions = result.unavailable === true ? null : result.suggestions
      if (!suggestions || Object.keys(suggestions).length === 0) {
        // The quiet fallback: retire the affordance for this session and
        // leave the plain Phase-4 form unchanged.
        setAutoFillHidden(true)
        toast.info('AI suggestions are unavailable — the form is unchanged.')
        return
      }
      // Snapshot the pre-suggestion form for "Undo suggestions", then apply.
      setPreSuggestion({ title, fieldValues })
      const { title: suggestedTitle, ...fieldSuggestions } = suggestions
      const keys = new Set<string>()
      if (typeof suggestedTitle === 'string' && suggestedTitle.trim()) {
        setTitle(suggestedTitle)
        keys.add('title')
      }
      setFieldValues((prev) => ({ ...prev, ...fieldSuggestions }))
      for (const key of Object.keys(fieldSuggestions)) keys.add(key)
      setSuggestedKeys(keys)
      // Suggested values were validated server-side; stale inline errors go.
      setFieldErrors({})
    } catch {
      // An unexpected failure (network, auth): the form stays unchanged and
      // the button stays (a transient error may succeed on retry).
      toast.info('AI suggestions are unavailable — the form is unchanged.')
    } finally {
      setAutoFillLoading(false)
    }
  }

  /** Restore the exact pre-suggestion form (title + field answers) and drop
   *  every suggestion marker. */
  const undoSuggestions = () => {
    if (!preSuggestion) return
    setTitle(preSuggestion.title)
    setFieldValues(preSuggestion.fieldValues)
    setPreSuggestion(null)
    setSuggestedKeys(new Set())
    setFieldErrors({})
  }

  const submit = () => {
    if (!canCreate) return
    const description = descriptionMarkdown.trim()
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      toast.error(`Description is too long (max ${DESCRIPTION_MAX_LENGTH} characters).`)
      return
    }

    // Registry-typed create: validate the answers into customAttributes with
    // the same validator the server enforces (agents fill the type's full
    // field set, customer-hidden fields included).
    let customAttributes: Record<string, unknown> | undefined
    if (selectedType) {
      const result = validateTicketIntakeValues(selectedFields, fieldValues, {
        includeInternal: true,
      })
      if (!result.ok) {
        setFieldErrors(
          result.errors.reduce<Record<string, string>>((acc, e: TicketIntakeError) => {
            acc[e.key] = e.message
            return acc
          }, {})
        )
        return
      }
      customAttributes = Object.keys(result.values).length > 0 ? result.values : undefined
    }

    create.mutate(
      {
        // A chosen registry type DERIVES the category server-side (the legacy
        // bare-category path only remains for a typeless workspace).
        type: selectedType ? undefined : fromConversation ? 'customer' : type,
        ticketTypeId: (selectedType?.id ?? undefined) as TicketTypeId | undefined,
        title: title.trim(),
        description: description || undefined,
        descriptionJson: isEmptyTiptapDoc(descriptionJson as TiptapContent | undefined)
          ? null
          : (descriptionJson as TiptapContent),
        requesterPrincipalId: requester?.principalId as PrincipalId | undefined,
        customAttributes,
        // Lets the create inherit this conversation's assignee (born owned by
        // whoever owns the conversation); the link row itself is written by
        // the linkTicketToConversationFn step below.
        sourceConversationId: conversationId,
      },
      {
        onSuccess: async (ticket) => {
          if (conversationId) {
            setLinking(true)
            try {
              await linkTicketToConversationFn({ data: { ticketId: ticket.id, conversationId } })
              toast.success('Ticket created')
            } catch (error) {
              // The ticket itself was created successfully — a link failure
              // (e.g. this conversation already has one) is a secondary,
              // recoverable problem, not a reason to hide the new ticket.
              toast.warning(
                error instanceof Error
                  ? `Ticket created, but couldn't link it: ${error.message}`
                  : "Ticket created, but couldn't link it to this conversation"
              )
            } finally {
              setLinking(false)
            }
          } else {
            toast.success('Ticket created')
          }
          onOpenChange(false)
          onCreated(ticket.id)
          onChanged?.()
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {fromConversation ? 'Create ticket' : 'New ticket'}
            {suggestedKeys.size > 0 && (
              <span className="ms-2 rounded bg-primary/15 px-1.5 py-0.5 align-middle text-[11px] font-medium text-primary">
                ✨ {suggestedKeys.size} suggested
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {fromConversation
              ? 'Open a trackable ticket for this conversation.'
              : 'Open a trackable request and set who it is for.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* The type picker: registry types when the workspace has them
              (always, post-0215 — unless every one is archived), else the
              legacy bare-category picker in the standalone flow. */}
          {candidates.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                {/* Phase 5 auto-fill entry: a button (explicit action), not an
                    auto-trigger on type selection — see runAutoFill's doc. */}
                {showAutoFill && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={runAutoFill}
                    disabled={autoFillLoading}
                  >
                    {autoFillLoading ? '✨ Suggesting…' : '✨ Auto-fill'}
                  </Button>
                )}
              </div>
              <Select value={selectedTypeId ?? ''} onValueChange={selectType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a type…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden>{t.icon}</span>
                        <span>{t.name}</span>
                        {!fromConversation && (
                          <span className="text-muted-foreground">
                            · {ticketTypeLabel(t.category)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            !fromConversation && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ticketTypeLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Title
              {suggestedKeys.has('title') && (
                <span className="ms-1 font-normal text-primary">✨ suggested</span>
              )}
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              placeholder="Summarize the request…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <RichTextEditor
              value={descriptionJson ?? ''}
              onChange={(json, _html, markdown) => {
                setDescriptionJson(json)
                setDescriptionMarkdown(markdown)
              }}
              features={CONVERSATION_EDITOR_FEATURES}
              onImageUpload={uploadImage}
              minHeight="120px"
              placeholder="Add details (optional). This opens the ticket thread."
            />
          </div>

          {/* The chosen type's field set — agents fill the full set (customer-
              hidden fields included); answers validate into customAttributes.
              Phase 5: suggestion provenance markers ride suggestedKeys. */}
          <TicketFormFields
            fields={selectedFields}
            values={fieldValues}
            onChange={setFieldValue}
            errors={fieldErrors}
            suggestedKeys={suggestedKeys}
            suggestionRun={suggestedKeys.size > 0}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {fromConversation ? 'Requester' : 'Requester (optional)'}
            </label>
            {requester ? (
              <div className="flex items-center gap-2.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <Avatar
                  src={requester.image}
                  name={requester.name ?? 'User'}
                  className="size-7 text-xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {requester.name || 'Unnamed user'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {realEmail(requester.email) ?? 'No email'}
                  </span>
                </span>
                {/* The conversation's visitor is fixed — only the standalone
                    flow's picked requester can be cleared. */}
                {!fromConversation && (
                  <button
                    type="button"
                    onClick={() => setRequester(null)}
                    aria-label="Clear requester"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <XMarkIcon className="size-4" />
                  </button>
                )}
              </div>
            ) : fromConversation ? (
              <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                Anonymous visitor — no portal account on file.
              </p>
            ) : (
              <PortalUserPicker
                onSelect={(u) => setRequester(u)}
                enabled={open && !requester}
                limit={6}
                searchRequired
              />
            )}
          </div>
        </div>

        <DialogFooter>
          {preSuggestion && (
            <Button
              type="button"
              variant="ghost"
              onClick={undoSuggestions}
              disabled={create.isPending || linking}
            >
              Undo suggestions
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canCreate}>
            {create.isPending || linking ? 'Creating…' : 'Create ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
