import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlusIcon, CheckIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TagChip } from '@/components/shared/tag-chip'
import type { ConversationTagDTO, ConversationDTO } from '@/lib/shared/conversation/types'
import type { ConversationId, ConversationTagId } from '@quackback/ids'
import {
  fetchConversationTagsFn,
  addConversationTagFn,
  removeConversationTagFn,
  updateConversationTagFn,
  deleteConversationTagFn,
} from '@/lib/server/functions/conversation-tags'
import { cn } from '@/lib/shared/utils'

const CONVERSATION_TAGS_KEY = ['admin', 'inbox', 'conversation-tags'] as const

// The palette offered when creating / recoloring a label. The first entry is the
// service-side default, so "no choice" matches what the server would pick anyway.
const TAG_COLORS = [
  '#6b7280',
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const
const DEFAULT_TAG_COLOR = TAG_COLORS[0]

/** The slice of the thread query cache this editor writes (it owns `tags`). */
type ThreadCache = { conversation: ConversationDTO; messages: unknown[]; hasMore?: boolean }

/** A compact swatch row for picking a label color. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className={cn(
            'h-4 w-4 rounded-full ring-offset-1 ring-offset-background transition',
            value.toLowerCase() === c.toLowerCase()
              ? 'ring-2 ring-foreground/60'
              : 'hover:scale-110'
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

/**
 * Inline label editor for a conversation: the current labels as removable chips
 * plus a "+ Add" popover that lists every label (toggle to apply/unapply),
 * offers to create a new one with a color, and lets agents rename / recolor /
 * delete a label in place.
 *
 * Mutations are AUTHORITATIVE over the thread cache: the add/remove server fns
 * return the conversation's updated tag list, which we write straight into the
 * thread query via setQueryData so the chips update immediately (relying only on
 * invalidate-and-refetch left the panel showing a just-created label stale until
 * a manual reload). The inbox list + the nav tag counts are still invalidated so
 * row chips and per-tag badges stay in sync. Reused by the thread header and the
 * detail panel.
 */
export function ConversationTagsEditor({
  conversationId,
  tags,
}: {
  conversationId: ConversationId
  tags: ConversationTagDTO[]
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [createColor, setCreateColor] = useState<string>(DEFAULT_TAG_COLOR)
  // The label currently being renamed/recolored inline (null = none).
  const [editingId, setEditingId] = useState<ConversationTagId | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string>(DEFAULT_TAG_COLOR)
  // Two-step guard for the destructive delete: deleting a label removes it from
  // EVERY conversation org-wide, so the trash action asks to confirm first
  // (distinct from the per-conversation chip remove).
  const [confirmDelete, setConfirmDelete] = useState(false)

  const threadKey = ['admin', 'inbox', 'thread', conversationId] as const

  // Only fetch the full label list when the picker is open.
  const { data: allTags } = useQuery({
    queryKey: CONVERSATION_TAGS_KEY,
    queryFn: () => fetchConversationTagsFn(),
    enabled: open,
    staleTime: 60_000,
  })

  // Write the conversation's tag list straight into the thread cache
  // (authoritative — the chips reflect the server response without waiting on a
  // refetch). add/remove pass the full returned list; update/delete map it.
  const patchThreadTags = (fn: (current: ConversationTagDTO[]) => ConversationTagDTO[]) =>
    queryClient.setQueryData<ThreadCache>(threadKey, (prev) =>
      prev
        ? { ...prev, conversation: { ...prev.conversation, tags: fn(prev.conversation.tags) } }
        : prev
    )
  // The inbox list rows + the nav per-tag counts (conversation-tags prefix also covers
  // the picker list and the '…conversation-tags','counts' nav query).
  const invalidateLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'conversations'] })
    void queryClient.invalidateQueries({ queryKey: CONVERSATION_TAGS_KEY })
  }

  const addMut = useMutation({
    mutationFn: (v: { tagId?: ConversationTagId; name?: string; color?: string }) =>
      addConversationTagFn({ data: { conversationId, ...v } }),
    onSuccess: (updated) => {
      patchThreadTags(() => updated)
      invalidateLists()
    },
    onError: () => toast.error('Failed to add tag'),
  })
  const removeMut = useMutation({
    mutationFn: (tagId: ConversationTagId) =>
      removeConversationTagFn({ data: { conversationId, tagId } }),
    onSuccess: (updated) => {
      patchThreadTags(() => updated)
      invalidateLists()
    },
    onError: () => toast.error('Failed to remove tag'),
  })
  const updateMut = useMutation({
    mutationFn: (v: { id: ConversationTagId; name?: string; color?: string }) =>
      updateConversationTagFn({ data: v }),
    onSuccess: (updated) => {
      // A renamed/recolored label updates wherever it's applied on this thread.
      patchThreadTags((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
      invalidateLists()
      setEditingId(null)
    },
    onError: () => toast.error('Failed to update tag'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: ConversationTagId) => deleteConversationTagFn({ data: { id } }),
    onSuccess: (_r, id) => {
      // A soft-deleted label drops off this conversation immediately.
      patchThreadTags((ts) => ts.filter((t) => t.id !== id))
      invalidateLists()
      setEditingId(null)
    },
    onError: () => toast.error('Failed to delete tag'),
  })

  const taggedIds = new Set(tags.map((t) => t.id))
  const q = query.trim().toLowerCase()
  const matching = (allTags ?? []).filter((t) => (q ? t.name.toLowerCase().includes(q) : true))
  const exactExists = (allTags ?? []).some((t) => t.name.toLowerCase() === q)
  // Offer "Create" as soon as the agent types a name with no exact match — even
  // before the tag list resolves. Creation is find-or-create (idempotent), so
  // it's safe to show while loading or if the list fetch failed, which is what
  // makes inline tagging reliably work from an empty taxonomy.
  const showCreate = q.length > 0 && !exactExists
  const loadingTags = open && allTags === undefined

  function beginEdit(tag: ConversationTagDTO) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
    setConfirmDelete(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => removeMut.mutate(t.id)} />
      ))}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setQuery('')
            setEditingId(null)
            setConfirmDelete(false)
            setCreateColor(DEFAULT_TAG_COLOR)
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:border-border hover:bg-muted/40 hover:text-muted-foreground"
          >
            <PlusIcon className="h-2.5 w-2.5" />
            Add
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or create…"
            className="mb-1.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
          <ScrollArea className="max-h-56">
            <div className="flex flex-col gap-0.5">
              {matching.map((t) => {
                const applied = taggedIds.has(t.id)
                if (editingId === t.id) {
                  return (
                    <div key={t.id} className="rounded-md bg-muted/40 p-1.5">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editName.trim())
                            updateMut.mutate({ id: t.id, name: editName.trim(), color: editColor })
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="mb-1.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <div className="mb-1.5">
                        <ColorSwatches value={editColor} onChange={setEditColor} />
                      </div>
                      <div className="flex items-center justify-between">
                        {confirmDelete ? (
                          <span className="flex items-center gap-1 text-[11px]">
                            <span className="text-muted-foreground">Delete everywhere?</span>
                            <button
                              type="button"
                              onClick={() => deleteMut.mutate(t.id)}
                              className="rounded px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/10"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(false)}
                              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted/60"
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                          >
                            <TrashIcon className="h-3 w-3" /> Delete
                          </button>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={!editName.trim()}
                            onClick={() =>
                              updateMut.mutate({
                                id: t.id,
                                name: editName.trim(),
                                color: editColor,
                              })
                            }
                            className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <div
                    key={t.id}
                    className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        applied ? removeMut.mutate(t.id) : addMut.mutate({ tagId: t.id })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate text-xs">{t.name}</span>
                      {applied && <CheckIcon className="h-3 w-3 shrink-0 text-primary" />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => beginEdit(t)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground"
                    >
                      <PencilIcon className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}

              {showCreate && (
                <div className="rounded-md p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      addMut.mutate({ name: query.trim(), color: createColor })
                      setQuery('')
                      setCreateColor(DEFAULT_TAG_COLOR)
                    }}
                    className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: createColor }}
                    />
                    <span className="truncate">
                      Create “<span className="font-medium text-foreground">{query.trim()}</span>”
                    </span>
                  </button>
                  <div className="mt-1.5">
                    <ColorSwatches value={createColor} onChange={setCreateColor} />
                  </div>
                </div>
              )}

              {loadingTags && matching.length === 0 && (
                <p className="px-1.5 py-1 text-xs text-muted-foreground/70">Loading tags…</p>
              )}
              {!loadingTags && matching.length === 0 && !showCreate && (
                <p className="px-1.5 py-1 text-xs text-muted-foreground">
                  {q ? 'No matching tags' : 'No tags yet — type to create one'}
                </p>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
