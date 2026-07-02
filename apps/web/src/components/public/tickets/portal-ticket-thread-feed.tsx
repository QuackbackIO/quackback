import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { FormattedMessage, useIntl } from 'react-intl'
import type { JSONContent } from '@tiptap/react'
import type { TicketId, TicketThreadId, PrincipalId } from '@quackback/ids'
import {
  RichTextContent,
  RichTextEditor,
  isRichTextContent,
} from '@/components/ui/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { TicketAttachments } from '@/components/tickets/ticket-attachments'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'

export interface PortalThread {
  id: TicketThreadId
  ticketId: TicketId
  principalId: PrincipalId | null
  bodyJson: unknown
  bodyText: string
  createdAt: Date
  editedAt: Date | null
}

export interface PortalTicketThreadFeedProps {
  threads: PortalThread[]
  /** Map of principalId → display name (the viewer's own name; staff names are masked). */
  principalNames: Record<string, string>
  /** The viewer's own principalId — their messages are labelled "You". */
  viewerPrincipalId: PrincipalId | null
  /** Optional initial-description block, rendered above threads. */
  description?: { text: string | null; json: unknown } | null
  /** Callback to save an edited description. When provided, the description is editable. */
  onDescriptionUpdate?: (json: JSONContent | null, text: string | null) => void
  /** Whether a description update is currently saving. */
  isDescriptionSaving?: boolean
}

function authorLabel(
  principalId: string | null,
  principalNames: Record<string, string>,
  viewerPrincipalId: string | null,
  intl: ReturnType<typeof useIntl>
): string {
  if (!principalId) {
    return intl.formatMessage({
      id: 'portal.tickets.detail.supportTeam',
      defaultMessage: 'Support team',
    })
  }
  if (principalId === viewerPrincipalId) {
    return intl.formatMessage({ id: 'portal.tickets.detail.you', defaultMessage: 'You' })
  }
  // Any other principal is staff — collapse to the unified "Support team" label.
  // (The principalNames map is kept so future variants can use it without
  // a new round-trip.)
  void principalNames
  return intl.formatMessage({
    id: 'portal.tickets.detail.supportTeam',
    defaultMessage: 'Support team',
  })
}

export function PortalTicketThreadFeed({
  threads,
  principalNames,
  viewerPrincipalId,
  description,
  onDescriptionUpdate,
  isDescriptionSaving,
}: PortalTicketThreadFeedProps) {
  const intl = useIntl()
  const { upload: uploadImage } = usePortalImageUpload()
  const hasDesc = description && (description.text || isRichTextContent(description.json))
  const [editingDescription, setEditingDescription] = useState(false)
  const [descDraft, setDescDraft] = useState<JSONContent | null>(null)
  const [descDraftText, setDescDraftText] = useState('')

  const startEditing = useCallback(() => {
    setDescDraft(isRichTextContent(description?.json) ? (description!.json as JSONContent) : null)
    setDescDraftText(description?.text ?? '')
    setEditingDescription(true)
  }, [description])

  const cancelEditing = useCallback(() => {
    setEditingDescription(false)
    setDescDraft(null)
    setDescDraftText('')
  }, [])

  const saveDescription = useCallback(() => {
    onDescriptionUpdate?.(descDraft, descDraftText || null)
    setEditingDescription(false)
  }, [onDescriptionUpdate, descDraft, descDraftText])

  if (!hasDesc && threads.length === 0 && !onDescriptionUpdate) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <FormattedMessage id="portal.tickets.detail.noReplies" defaultMessage="No replies yet." />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {editingDescription ? (
        <article className="rounded-md border border-border/50 bg-muted/20 p-3">
          <header className="mb-2 text-xs text-muted-foreground">
            <FormattedMessage id="portal.tickets.detail.description" defaultMessage="Description" />
          </header>
          <div className="rounded border">
            <RichTextEditor
              value={descDraft ?? undefined}
              onChange={(json, _html, markdown) => {
                setDescDraft(json)
                setDescDraftText(markdown)
              }}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.detail.descriptionPlaceholder',
                defaultMessage: 'Add a description…',
              })}
              minHeight="80px"
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
          <div className="flex items-center gap-1 mt-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEditing}
              disabled={isDescriptionSaving}
            >
              <FormattedMessage id="portal.tickets.detail.cancel" defaultMessage="Cancel" />
            </Button>
            <Button size="sm" onClick={saveDescription} disabled={isDescriptionSaving}>
              {isDescriptionSaving ? (
                <FormattedMessage id="portal.tickets.detail.saving" defaultMessage="Saving…" />
              ) : (
                <FormattedMessage id="portal.tickets.detail.save" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </article>
      ) : hasDesc ? (
        <article className="group relative rounded-md border border-border/50 bg-muted/20 p-3">
          <header className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
            <FormattedMessage id="portal.tickets.detail.description" defaultMessage="Description" />
            {onDescriptionUpdate && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={startEditing}
              >
                <Pencil className="size-3 mr-1" />
                <FormattedMessage id="portal.tickets.detail.edit" defaultMessage="Edit" />
              </Button>
            )}
          </header>
          {isRichTextContent(description!.json) ? (
            <RichTextContent content={description!.json} className="prose-sm" />
          ) : (
            <div className="whitespace-pre-wrap text-sm">{description!.text}</div>
          )}
        </article>
      ) : onDescriptionUpdate ? (
        <button
          onClick={startEditing}
          className="w-full rounded-md border border-dashed border-border/50 bg-muted/10 p-3 text-sm text-muted-foreground hover:bg-muted/30 transition-colors text-left"
        >
          <FormattedMessage
            id="portal.tickets.detail.addDescription"
            defaultMessage="+ Add a description…"
          />
        </button>
      ) : null}
      {threads.map((th) => {
        const author = authorLabel(th.principalId, principalNames, viewerPrincipalId, intl)
        const isViewer = th.principalId === viewerPrincipalId
        return (
          <article
            key={th.id}
            className="rounded-md border border-border/50 bg-background p-3"
            aria-label={`Reply from ${author}`}
          >
            <header className="mb-2 flex items-center gap-2 text-xs">
              <span className={isViewer ? 'font-medium text-foreground' : 'font-medium'}>
                {author}
              </span>
              <span className="text-muted-foreground">
                · {formatDistanceToNow(th.createdAt, { addSuffix: true })}
                {th.editedAt && (
                  <span className="ml-1 italic">
                    (
                    <FormattedMessage id="portal.tickets.detail.edited" defaultMessage="edited" />)
                  </span>
                )}
              </span>
            </header>
            {isRichTextContent(th.bodyJson) ? (
              <RichTextContent content={th.bodyJson} className="prose-sm" />
            ) : (
              <div className="whitespace-pre-wrap text-sm">{th.bodyText}</div>
            )}
            <PortalThreadAttachmentsLoader ticketId={th.ticketId} threadId={th.id} />
          </article>
        )
      })}
    </div>
  )
}

function PortalThreadAttachmentsLoader({
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
