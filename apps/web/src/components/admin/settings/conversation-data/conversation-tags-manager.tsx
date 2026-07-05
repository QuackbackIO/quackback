/**
 * Conversation tags manager (Settings > Conversation data > Tags): the
 * org-wide label taxonomy with total usage counts that click through to the
 * filtered inbox, rename/recolor (propagates everywhere by id), archive/
 * restore, and permanent delete behind archive. Archive and delete are
 * refused server-side while a live workflow or macro references the tag (the
 * error names them). The inbox keeps its inline apply + quick-create flow.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid'
import { ArchiveBoxIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationTagId } from '@quackback/ids'
import {
  listConversationTagsForSettingsFn,
  updateConversationTagFn,
  deleteConversationTagFn,
  restoreConversationTagFn,
  hardDeleteConversationTagFn,
} from '@/lib/server/functions/conversation-tags'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ColorPickerGrid } from '@/components/shared/color-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/shared/utils'

type TagRow = Awaited<ReturnType<typeof listConversationTagsForSettingsFn>>[number]

const TAGS_SETTINGS_KEY = ['admin', 'conversation-tags', 'settings']

function EditTagDialog({
  tag,
  onClose,
  onSave,
  isPending,
}: {
  tag: TagRow
  onClose: () => void
  onSave: (input: { name: string; color: string }) => Promise<void>
  isPending: boolean
}) {
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState(tag.color)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit tag</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name</Label>
            <Input
              id="tag-name"
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Renaming updates the tag everywhere it is applied.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || isPending}
            onClick={() => void onSave({ name: name.trim(), color })}
          >
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConversationTagsManager() {
  const queryClient = useQueryClient()
  const { data: tags } = useQuery({
    queryKey: TAGS_SETTINGS_KEY,
    queryFn: () => listConversationTagsForSettingsFn(),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'conversation-tags'] })
    // The inbox nav + pickers cache tag lists under their own keys too.
    void queryClient.invalidateQueries({ queryKey: TAGS_SETTINGS_KEY })
  }
  const onError = (fallback: string) => (e: unknown) =>
    toast.error(e instanceof Error ? e.message : fallback)

  const updateTag = useMutation({
    mutationFn: (input: { id: ConversationTagId; name: string; color: string }) =>
      updateConversationTagFn({ data: input }),
    onSuccess: invalidate,
    onError: onError('Failed to update tag'),
  })
  const archiveTag = useMutation({
    mutationFn: (id: ConversationTagId) => deleteConversationTagFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError('Failed to archive tag'),
  })
  const restoreTag = useMutation({
    mutationFn: (id: ConversationTagId) => restoreConversationTagFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError('Failed to restore tag'),
  })
  const hardDeleteTag = useMutation({
    mutationFn: (id: ConversationTagId) => hardDeleteConversationTagFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError('Failed to delete tag'),
  })

  const [editTarget, setEditTarget] = useState<TagRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<TagRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null)

  const live = (tags ?? []).filter((t) => !t.archived)
  const archived = (tags ?? []).filter((t) => t.archived)

  return (
    <SettingsCard
      title="Conversation tags"
      description="Labels agents apply to conversations. Agents create them inline from the inbox; manage the taxonomy here."
    >
      {!tags || tags.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No tags yet. Agents create them inline from a conversation.
        </p>
      ) : (
        <div>
          {[...live, ...archived].map((tag) => (
            <div
              key={tag.id}
              className={cn(
                'flex items-center gap-3 border-b border-border/50 py-3 last:border-0',
                tag.archived && 'opacity-60'
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {tag.name}
                {tag.archived && (
                  <span className="ml-2 inline-flex items-center rounded border border-border/50 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Archived
                  </span>
                )}
              </span>
              {tag.archived ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tag.count} conversation{tag.count === 1 ? '' : 's'}
                </span>
              ) : (
                <Link
                  to="/admin/inbox"
                  search={{ tag: tag.id }}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  title="Open in the inbox"
                >
                  {tag.count} conversation{tag.count === 1 ? '' : 's'}
                </Link>
              )}
              <div className="flex shrink-0 items-center gap-1">
                {tag.archived ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => restoreTag.mutate(tag.id)}
                      title="Restore tag"
                    >
                      <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(tag)}
                      title="Delete permanently"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditTarget(tag)}
                      title="Edit tag"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => setArchiveTarget(tag)}
                      title="Archive tag"
                    >
                      <ArchiveBoxIcon className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <EditTagDialog
          tag={editTarget}
          onClose={() => setEditTarget(null)}
          isPending={updateTag.isPending}
          onSave={async (input) => {
            await updateTag.mutateAsync({ id: editTarget.id, ...input })
            setEditTarget(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive "${archiveTarget?.name}"?`}
        description="The tag disappears from pickers and filters. Conversation history keeps it and the name stays reserved; you can restore it at any time. Tags used by live workflows or macros cannot be archived."
        confirmLabel="Archive"
        isPending={archiveTag.isPending}
        onConfirm={async () => {
          if (!archiveTarget) return
          await archiveTag.mutateAsync(archiveTarget.id)
          setArchiveTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}" permanently?`}
        description={`This removes the tag from ${deleteTarget?.count ?? 0} conversation${deleteTarget?.count === 1 ? '' : 's'} and cannot be undone.`}
        confirmLabel="Delete permanently"
        variant="destructive"
        isPending={hardDeleteTag.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return
          await hardDeleteTag.mutateAsync(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </SettingsCard>
  )
}
