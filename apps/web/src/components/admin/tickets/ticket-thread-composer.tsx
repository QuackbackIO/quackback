/**
 * Composer for posting a new thread on a ticket. Audience tabs (Public /
 * Internal / Shared with team) are gated by the actor's permissions for this
 * ticket. The shared-team tab requires picking a team via `<TeamPicker />`.
 */
import { useState, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import type { TicketId, TeamId, TicketThreadId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { addThreadFn } from '@/lib/server/functions/tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { toast } from 'sonner'
import { cn } from '@/lib/shared/utils'
import { X, Upload } from 'lucide-react'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'

export type ComposerAudience = 'public' | 'internal' | 'shared_team'

export interface TicketThreadComposerProps {
  ticketId: TicketId
  /** Permission flags resolved by the parent (uses canReplyPublic etc). */
  canPublic: boolean
  canInternal: boolean
  canShared: boolean
  onPosted?: () => void
}

function plainTextFromJson(json: JSONContent | null): string {
  if (!json) return ''
  let out = ''
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && typeof node.text === 'string') out += node.text
    if (node.content) node.content.forEach(walk)
    if (node.type === 'paragraph' || node.type === 'heading') out += '\n'
  }
  walk(json)
  return out.trim()
}

export function TicketThreadComposer({
  ticketId,
  canPublic,
  canInternal,
  canShared,
  onPosted,
}: TicketThreadComposerProps) {
  const qc = useQueryClient()
  const { upload: uploadImage } = useImageUpload({ prefix: 'uploads' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const allowedTabs = useMemo(() => {
    const tabs: ComposerAudience[] = []
    if (canPublic) tabs.push('public')
    if (canInternal) tabs.push('internal')
    if (canShared) tabs.push('shared_team')
    return tabs
  }, [canPublic, canInternal, canShared])

  const [audience, setAudience] = useState<ComposerAudience>(allowedTabs[0] ?? 'internal')
  const [body, setBody] = useState<JSONContent | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [sharedTeamId, setSharedTeamId] = useState<TeamId | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const postMutation = useMutation({
    mutationFn: async () => {
      const thread = await addThreadFn({
        data: {
          ticketId,
          audience,
          bodyJson: body as unknown as { type: 'doc'; content?: unknown[] } | null,
          bodyText: bodyText || plainTextFromJson(body),
          sharedWithTeamId: audience === 'shared_team' ? sharedTeamId : null,
        },
      })

      // Upload files if any
      if (selectedFiles.length > 0 && thread?.id) {
        const threadId = thread.id as TicketThreadId
        for (const file of selectedFiles) {
          try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch(`/api/v1/tickets/${ticketId}/threads/${threadId}/attachments`, {
              method: 'POST',
              body: formData,
            })
            if (!res.ok) {
              const error = await res.text()
              throw new Error(`Upload failed: ${error}`)
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Upload failed'
            toast.error(`Failed to upload ${file.name}: ${msg}`)
          }
        }
        // Invalidate attachments query for this thread
        qc.invalidateQueries({ queryKey: ticketQueries.attachments(ticketId, threadId).queryKey })
      }

      return thread
    },
    onSuccess: () => {
      setBody(null)
      setBodyText('')
      setSelectedFiles([])
      qc.invalidateQueries({ queryKey: ticketQueries.threads(ticketId).queryKey })
      qc.invalidateQueries({ queryKey: ticketQueries.detail(ticketId).queryKey })
      qc.invalidateQueries({ queryKey: ['tickets', 'list'] })
      onPosted?.()
      toast.success('Reply posted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (allowedTabs.length === 0) {
    return (
      <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
        You don&apos;t have permission to reply on this ticket.
      </div>
    )
  }

  const isEmpty = !bodyText.trim() && (!body || plainTextFromJson(body).length === 0)
  const sharedNeedsTeam = audience === 'shared_team' && !sharedTeamId

  return (
    <div className="border-t border-border/50 bg-background p-3">
      <Tabs
        value={audience}
        onValueChange={(v) => setAudience(v as ComposerAudience)}
        className="mb-2"
      >
        <TabsList>
          {canPublic && <TabsTrigger value="public">Public reply</TabsTrigger>}
          {canInternal && <TabsTrigger value="internal">Internal note</TabsTrigger>}
          {canShared && <TabsTrigger value="shared_team">Share with team</TabsTrigger>}
        </TabsList>
      </Tabs>

      {audience === 'shared_team' && (
        <div className="mb-2">
          <TeamPicker
            value={sharedTeamId}
            onValueChange={setSharedTeamId}
            placeholder="Pick team to share with…"
          />
        </div>
      )}

      <div
        className={cn(
          'rounded border',
          audience === 'internal' && 'border-amber-300/60',
          audience === 'shared_team' && 'border-purple-300/60'
        )}
      >
        <RichTextEditor
          value={body ?? undefined}
          onChange={(json, _html, markdown) => {
            setBody(json)
            setBodyText(markdown)
          }}
          placeholder={
            audience === 'public'
              ? 'Reply to customer…'
              : audience === 'internal'
                ? 'Internal note (only agents can see this)…'
                : 'Visible to your team and the picked team…'
          }
          minHeight="100px"
          features={{
            headings: false,
            codeBlocks: true,
            blockquotes: true,
            dividers: false,
            images: true,
            taskLists: false,
            tables: false,
            embeds: false,
            slashMenu: false,
          }}
          onImageUpload={uploadImage}
        />
      </div>

      {/* File picker and list */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            setSelectedFiles(Array.from(e.target.files))
          }
        }}
      />

      {selectedFiles.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Attachments ({selectedFiles.length})
          </div>
          <div className="space-y-1">
            {selectedFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFiles((prev) => prev.filter((f) => f.name !== file.name))
                  }
                  className="ml-2 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4 mr-1" />
          Attach files
        </Button>
        <Button
          size="sm"
          onClick={() => postMutation.mutate()}
          disabled={isEmpty || sharedNeedsTeam || postMutation.isPending}
        >
          {postMutation.isPending ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </div>
  )
}
