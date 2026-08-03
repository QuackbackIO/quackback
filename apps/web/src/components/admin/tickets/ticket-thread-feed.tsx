/**
 * Thread feed for the ticket-detail page. Renders threads in chronological
 * order with audience-aware bubble styling: public = neutral card, internal =
 * yellow tinted, shared_team = purple tinted with the team label.
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import type { TicketId, TeamId, PrincipalId, TicketThreadId } from '@quackback/ids'
import { cn } from '@/lib/shared/utils'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  RichTextContent,
  RichTextEditor,
  isRichTextContent,
} from '@/components/ui/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { TicketAttachments } from '@/components/tickets/ticket-attachments'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'

export interface ThreadRow {
  id: TicketThreadId
  ticketId: TicketId
  principalId: PrincipalId | null
  audience: 'public' | 'internal' | 'shared_team'
  bodyJson: unknown
  bodyText: string
  sharedWithTeamId: TeamId | null
  createdAt: Date | string
  editedAt: Date | string | null
}

export interface TicketThreadFeedProps {
  threads: ThreadRow[]
  /** Optional fallback ticketId for attachment lookups when thread rows omit it. */
  fallbackTicketId?: TicketId
  /** Optional map of teamId → teamName for nicer "Shared with X" labels. */
  teamNames?: Record<string, string>
  /** Optional map of principalId → display name for author labels. */
  principalNames?: Record<string, string>
  /** Optional initial-description block (rendered before first thread). */
  description?: { text: string | null; json: unknown } | null
  /** Callback to save an edited description. When provided, the description is editable. */
  onDescriptionUpdate?: (json: JSONContent | null, text: string | null) => void
  /** Whether a description update is currently saving. */
  isDescriptionSaving?: boolean
}

const DESCRIPTION_EDITOR_FEATURES = {
  headings: false,
  codeBlocks: true,
  blockquotes: true,
  dividers: false,
  images: true,
  taskLists: false,
  tables: false,
  embeds: false,
  slashMenu: false,
} as const

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

function textToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : undefined,
    })),
  }
}

function hasMeaningfulJsonContent(content: unknown): content is JSONContent {
  if (!isRichTextContent(content)) return false
  const visit = (node: JSONContent): boolean => {
    if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0
    if (node.type === 'image' || node.type === 'quackbackEmbed' || node.type === 'horizontalRule') {
      return true
    }
    return node.content?.some(visit) ?? false
  }
  return visit(content)
}

function hasDescriptionContent(
  description: { text: string | null; json: unknown } | null | undefined
) {
  return Boolean(
    description &&
    ((description.text?.trim() ?? '').length > 0 || hasMeaningfulJsonContent(description.json))
  )
}

const audienceStyles: Record<ThreadRow['audience'], string> = {
  public: 'border-border/50 bg-background',
  internal: 'border-amber-300/60 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20',
  shared_team:
    'border-purple-300/60 bg-purple-50/60 dark:border-purple-900/40 dark:bg-purple-950/20',
}

const audienceLabels: Record<ThreadRow['audience'], string> = {
  public: 'Public',
  internal: 'Internal note',
  shared_team: 'Shared with team',
}

export function TicketThreadFeed({
  threads,
  fallbackTicketId,
  teamNames,
  principalNames,
  description,
  onDescriptionUpdate,
  isDescriptionSaving,
}: TicketThreadFeedProps) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'uploads' })
  const hasDesc = hasDescriptionContent(description)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descDraft, setDescDraft] = useState<JSONContent | null>(null)
  const [descDraftText, setDescDraftText] = useState('')

  const startEditingDescription = useCallback(() => {
    const currentText = description?.text ?? ''
    const currentJson = isRichTextContent(description?.json)
      ? (description!.json as JSONContent)
      : null
    setDescDraft(currentJson ?? (currentText ? textToDoc(currentText) : null))
    setDescDraftText(currentText)
    setEditingDescription(true)
  }, [description])

  const cancelEditingDescription = useCallback(() => {
    setEditingDescription(false)
    setDescDraft(null)
    setDescDraftText('')
  }, [])

  const saveDescription = useCallback(() => {
    const nextText = descDraftText.trim() || plainTextFromJson(descDraft)
    const nextJson = hasMeaningfulJsonContent(descDraft) ? descDraft : null
    onDescriptionUpdate?.(nextJson, nextText || null)
    setEditingDescription(false)
  }, [descDraft, descDraftText, onDescriptionUpdate])

  if (threads.length === 0 && !hasDesc) {
    if (!onDescriptionUpdate) {
      return <div className="text-sm text-muted-foreground py-6 text-center">No replies yet.</div>
    }
  }
  return (
    <div className="space-y-3">
      {editingDescription ? (
        <article className="rounded-md border border-border/50 bg-muted/20 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Description</div>
          <div className="rounded border bg-background">
            <RichTextEditor
              value={descDraft ?? undefined}
              onChange={(json, _html, markdown) => {
                setDescDraft(json)
                setDescDraftText(markdown)
              }}
              placeholder="Add a description..."
              minHeight="100px"
              features={DESCRIPTION_EDITOR_FEATURES}
              onImageUpload={uploadImage}
            />
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEditingDescription}
              disabled={isDescriptionSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveDescription} disabled={isDescriptionSaving}>
              {isDescriptionSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </article>
      ) : hasDesc ? (
        <article className="group rounded-md border border-border/50 bg-muted/20 p-3">
          <header className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span>Description</span>
            {onDescriptionUpdate && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={startEditingDescription}
              >
                <Pencil className="mr-1 size-3" />
                Edit
              </Button>
            )}
          </header>
          {hasMeaningfulJsonContent(description!.json) ? (
            <RichTextContent content={description!.json} className="prose-sm" />
          ) : (
            <div className="text-sm whitespace-pre-wrap">{description!.text}</div>
          )}
        </article>
      ) : onDescriptionUpdate ? (
        <button
          type="button"
          onClick={startEditingDescription}
          className="w-full rounded-md border border-dashed border-border/50 bg-muted/10 p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/30"
        >
          Add a description...
        </button>
      ) : null}
      {threads.map((th) => {
        const teamLabel =
          th.audience === 'shared_team' && th.sharedWithTeamId
            ? (teamNames?.[th.sharedWithTeamId] ?? th.sharedWithTeamId)
            : null
        const author = th.principalId ? (principalNames?.[th.principalId] ?? 'Unknown') : 'System'
        return (
          <article key={th.id} className={cn('rounded-md border p-3', audienceStyles[th.audience])}>
            <header className="flex items-center justify-between text-xs mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{author}</span>
                <span className="text-muted-foreground">
                  · <TimeAgo date={th.createdAt} />
                  {th.editedAt && <span className="ml-1 italic">(edited)</span>}
                </span>
              </div>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {audienceLabels[th.audience]}
                {teamLabel && <span className="ml-1 normal-case">· {teamLabel}</span>}
              </span>
            </header>
            {isRichTextContent(th.bodyJson) ? (
              <RichTextContent content={th.bodyJson} className="prose-sm" />
            ) : (
              <div className="text-sm whitespace-pre-wrap">{th.bodyText}</div>
            )}
            <ThreadAttachmentsLoader
              ticketId={(th.ticketId ?? fallbackTicketId) as TicketId}
              threadId={th.id}
            />
          </article>
        )
      })}
    </div>
  )
}

function ThreadAttachmentsLoader({
  ticketId,
  threadId,
}: {
  ticketId: TicketId
  threadId: TicketThreadId
}) {
  const {
    data: attachments,
    isLoading,
    isError,
  } = useQuery(ticketQueries.attachments(ticketId, threadId))

  if (isError || (!isLoading && (!attachments || attachments.length === 0))) {
    return null
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <TicketAttachments attachments={attachments ?? []} isLoading={isLoading} />
    </div>
  )
}
